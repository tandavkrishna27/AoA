"""Linux-only, operator-bound private holder socket.

Wire format: four-byte big-endian JSON length followed by UTF-8 JSON. Bytes
are canonical base64 in JSON; missing values are JSON null. Every data
operation requires a live lock on this connection. No request selects a root.
"""

import base64
import binascii
from contextlib import contextmanager
import fcntl
import json
import os
import posixpath
import select
import socket
import stat
import struct
import sys
import threading
import time

from scripts.m1_holder.store import Store, StoreError

MAX_RAW_CHUNK = 1024 * 1024
MAX_FRAME = 2 * 1024 * 1024
MAX_CONNECTIONS = 8
LOCK_NAME = '.holder.lock'


class ProtocolError(ValueError):
    pass


def _require(value):
    if not value:
        raise ProtocolError()


def _pairs(items):
    result = {}
    for key, value in items:
        _require(key not in result)
        result[key] = value
    return result


def _receive(conn, count, deadline):
    data = bytearray()
    while len(data) < count:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        conn.settimeout(remaining)
        part = conn.recv(min(count - len(data), 65536))
        if not part:
            raise EOFError()
        data.extend(part)
    return bytes(data)


def _request(conn, deadline):
    length = struct.unpack('!I', _receive(conn, 4, deadline))[0]
    _require(0 < length <= MAX_FRAME)
    value = json.loads(_receive(conn, length, deadline).decode('utf-8'),
                       object_pairs_hook=_pairs,
                       parse_constant=lambda _: _require(False))
    _require(type(value) is dict)
    return value


def _reply(conn, value, deadline):
    raw = json.dumps(value, separators=(',', ':'), sort_keys=True).encode('ascii')
    _require(len(raw) <= MAX_FRAME)
    frame = memoryview(struct.pack('!I', len(raw)) + raw)
    conn.setblocking(False)
    while frame:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([], [conn], [], remaining)[1]:
            raise TimeoutError()
        try:
            sent = conn.send(frame)
        except BlockingIOError:
            continue
        _require(sent > 0)
        frame = frame[sent:]


def _bytes(value):
    _require(type(value) is str and len(value) <= ((MAX_RAW_CHUNK + 2) // 3) * 4)
    try:
        raw = base64.b64decode(value, validate=True)
    except binascii.Error:
        raise ProtocolError() from None
    _require(len(raw) <= MAX_RAW_CHUNK and base64.b64encode(raw).decode('ascii') == value)
    return raw


def _lock_fd(store):
    with store._directory() as directory:
        fd = os.open(LOCK_NAME, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600,
                     dir_fd=directory)
    info = os.fstat(fd)
    if not (stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1):
        os.close(fd)
        raise StoreError()
    return fd


def _acquire(fd, deadline):
    while True:
        if time.monotonic() >= deadline:
            raise TimeoutError()
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if time.monotonic() >= deadline:
                fcntl.flock(fd, fcntl.LOCK_UN)
                raise TimeoutError()
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise TimeoutError() from None
            time.sleep(min(0.01, max(0, deadline - time.monotonic())))


def _handle(conn, store, uid, gid, timeout, lease_duration):
    fd = None
    lease_deadline = None
    try:
        _pid, peer_uid, peer_gid = struct.unpack('3i', conn.getsockopt(
            socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i')))
        if peer_uid != uid or peer_gid != gid:
            return
        while True:
            request_deadline = time.monotonic() + timeout
            deadline = min(request_deadline, lease_deadline) if lease_deadline else request_deadline
            request = _request(conn, deadline)
            if time.monotonic() >= deadline:
                return
            op = request.get('op')
            try:
                if op == 'lock' and set(request) == {'op'} and fd is None:
                    candidate = _lock_fd(store)
                    try:
                        _acquire(candidate, request_deadline)
                    except BaseException:
                        os.close(candidate)
                        raise
                    fd = candidate
                    lease_deadline = time.monotonic() + lease_duration
                    result = {'ok': True}
                elif op == 'unlock' and set(request) == {'op'} and fd is not None:
                    fcntl.flock(fd, fcntl.LOCK_UN)
                    os.close(fd)
                    fd = None
                    lease_deadline = None
                    result = {'ok': True}
                elif fd is not None and op == 'read' and set(request) == {'op', 'key'}:
                    result = {'ok': True, 'value': store.read(request['key'])}
                elif fd is not None and op == 'readBytes' and set(request) == {'op', 'key'}:
                    raw = store.read_bytes(request['key'], MAX_RAW_CHUNK)
                    result = {'ok': True, 'value': None if raw is None else
                              base64.b64encode(raw).decode('ascii')}
                elif fd is not None and op == 'commit' and set(request) == {
                        'op', 'key', 'record', 'bytes'}:
                    raw = None if request['bytes'] is None else _bytes(request['bytes'])
                    store.commit(request['key'], request['record'], raw)
                    result = {'ok': True}
                else:
                    raise ProtocolError()
            except (StoreError, ProtocolError, TimeoutError, TypeError, ValueError):
                result = {'ok': False}
            if time.monotonic() >= request_deadline or (lease_deadline is not None
                    and time.monotonic() >= lease_deadline):
                return
            _reply(conn, result, min(request_deadline, lease_deadline)
                   if lease_deadline is not None else request_deadline)
            if store._failed:
                return
    except (EOFError, OSError, socket.timeout, UnicodeError, ValueError,
            ProtocolError, json.JSONDecodeError, TimeoutError):
        return
    finally:
        if fd is not None:
            os.close(fd)
        conn.close()


def _handle_limited(conn, store, uid, gid, timeout, lease_duration, slots):
    try:
        _handle(conn, store, uid, gid, timeout, lease_duration)
    finally:
        slots.release()


@contextmanager
def _socket_parent(path, peer_gid):
    fd = None
    try:
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        for part in path.split('/')[1:-1]:
            info = os.fstat(fd)
            _require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, os.geteuid())
                     and (info.st_mode & 0o022 == 0 or
                          info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)))
            if info.st_uid == os.geteuid() and info.st_uid != 0:
                _require(info.st_gid == peer_gid and bool(info.st_mode & stat.S_IXGRP))
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        _require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                 and stat.S_IMODE(info.st_mode) == 0o710 and info.st_gid == peer_gid)
        yield fd
    except OSError:
        raise ProtocolError() from None
    finally:
        if fd is not None:
            os.close(fd)


def _serve(socket_path, root, peer_uid, peer_gid, timeout, lease_duration,
           *, allow_same_uid=False):
    if sys.platform != 'linux' or not (type(peer_uid) is int and type(peer_gid) is int
            and peer_uid >= 0 and peer_gid >= 0 and type(timeout) in (int, float)
            and 0 < timeout <= 60 and type(lease_duration) in (int, float)
            and 0 < lease_duration <= 60 and (allow_same_uid or peer_uid != os.geteuid())):
        raise ProtocolError()
    store = Store(root)
    _require(type(socket_path) is str and socket_path.startswith('/')
             and not socket_path.startswith('//') and '\x00' not in socket_path
             and '\\' not in socket_path and posixpath.normpath(socket_path) == socket_path)
    parent, name = posixpath.split(socket_path)
    _require(parent not in ('', '/') and name not in ('', '.', '..'))
    with _socket_parent(socket_path, peer_gid) as directory:
        try:
            os.stat(name, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise ProtocolError()
        listener = socket.socket(socket.AF_UNIX)
        try:
            # The open parent fd pins the validated directory during bind.
            listener.bind(f'/proc/self/fd/{directory}/{name}')
            os.chown(name, -1, peer_gid, dir_fd=directory, follow_symlinks=False)
            os.chmod(name, 0o660, dir_fd=directory)
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            _require(stat.S_ISSOCK(info.st_mode) and info.st_uid == os.geteuid()
                     and info.st_gid == peer_gid and stat.S_IMODE(info.st_mode) == 0o660)
            listener.listen(MAX_CONNECTIONS)
        except BaseException:
            listener.close()
            raise
    try:
        slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        while True:
            conn, _ = listener.accept()
            if not slots.acquire(blocking=False):
                conn.close()
                continue
            try:
                threading.Thread(target=_handle_limited,
                                 args=(conn, store, peer_uid, peer_gid, timeout,
                                       lease_duration, slots), daemon=True).start()
            except BaseException:
                slots.release()
                conn.close()
                raise
    finally:
        listener.close()


def serve(socket_path, root, peer_uid, peer_gid, timeout, lease_duration):
    _serve(socket_path, root, peer_uid, peer_gid, timeout, lease_duration)


if __name__ == '__main__':
    if len(sys.argv) != 7:
        raise SystemExit(2)
    serve(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]),
          float(sys.argv[5]), float(sys.argv[6]))
