"""Linux-only private immutable record and byte storage.

The caller owns cross-process exclusion and authorization. This module grants
neither candidate authority nor a first-byte capture guarantee.
"""

from contextlib import contextmanager
import builtins
import json
import os
import posixpath
import re
import stat
import sys
import uuid

MAX_RECORD_BYTES = 65536
MAX_BYTES = 64 * 1024 * 1024
KEY = re.compile(r'[0-9a-f]{64}(?::(?:0|[1-9][0-9]*))?\Z', re.ASCII)


class StoreError(ValueError):
    def __init__(self):
        super().__init__('holder-store-refused')


def _require(condition):
    if not condition:
        raise StoreError()


def _file(fd):
    info = os.fstat(fd)
    _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1)
    return info


class Store:
    def __init__(self, root: str):
        _require(sys.platform == 'linux' and hasattr(os, 'O_NOFOLLOW'))
        _require(type(root) is str and root.startswith('/') and not root.startswith('//')
                 and root != '/' and '\x00' not in root and '\\' not in root
                 and posixpath.normpath(root) == root)
        self.root = root
        self._owner_uid = os.geteuid()
        self._identity = None
        self._failed = False
        with self._directory() as fd:
            info = os.fstat(fd)
            self._identity = (info.st_dev, info.st_ino)

    @contextmanager
    def _directory(self):
        _require(not self._failed)
        fd = None
        try:
            fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            for part in self.root.split('/')[1:]:
                info = os.fstat(fd)
                _require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, self._owner_uid)
                         and (info.st_mode & 0o022 == 0 or
                              info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)))
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=fd)
                os.close(fd)
                fd = child
            info = os.fstat(fd)
            _require(stat.S_ISDIR(info.st_mode) and info.st_uid == self._owner_uid
                     and stat.S_IMODE(info.st_mode) == 0o700)
            if self._identity is not None:
                _require((info.st_dev, info.st_ino) == self._identity)
            yield fd
        except OSError:
            self._failed = True
            raise StoreError() from None
        finally:
            if fd is not None:
                os.close(fd)

    @staticmethod
    def _key(key):
        _require(type(key) is str and KEY.fullmatch(key) is not None)
        return key.replace(':', '-')

    @staticmethod
    def _read_file(directory, name, limit):
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=directory)
        except FileNotFoundError:
            return None
        try:
            info = _file(fd)
            _require(info.st_size <= limit)
            raw = bytearray()
            while len(raw) <= limit:
                part = os.read(fd, min(8192, limit + 1 - len(raw)))
                if not part:
                    break
                raw.extend(part)
            _require(len(raw) <= limit and os.fstat(fd).st_size == len(raw))
            return bytes(raw)
        finally:
            os.close(fd)

    @staticmethod
    def _sync_file(directory, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=directory)
        try:
            _file(fd)
            os.fsync(fd)
        finally:
            os.close(fd)

    @staticmethod
    def _record(raw):
        def pairs(items):
            result = {}
            for key, value in items:
                _require(key not in result)
                result[key] = value
            return result

        try:
            value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                               parse_constant=lambda _: (_require(False)))
            _require(type(value) is dict and Store._encode(value) == raw)
            return value
        except (UnicodeError, ValueError, TypeError):
            raise StoreError() from None

    @staticmethod
    def _encode(record):
        _require(type(record) is dict)
        try:
            raw = json.dumps(record, sort_keys=True, separators=(',', ':'),
                             ensure_ascii=True, allow_nan=False).encode('ascii')
        except (TypeError, ValueError, OverflowError):
            raise StoreError() from None
        _require(0 < len(raw) <= MAX_RECORD_BYTES)
        return raw

    @staticmethod
    def _publish(directory, name, raw):
        temporary = '.tmp-' + name + '-' + uuid.uuid4().hex
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        try:
            _file(fd)
            view = memoryview(raw)
            while view:
                count = os.write(fd, view)
                _require(count > 0)
                view = view[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
        # A hard link publishes without replacement. Failed temp files are retained.
        os.link(temporary, name, src_dir_fd=directory, dst_dir_fd=directory,
                follow_symlinks=False)
        os.fsync(directory)
        os.unlink(temporary, dir_fd=directory)
        os.fsync(directory)

    @staticmethod
    def _partials(directory, base):
        prefixes = ('.tmp-' + base + '.json-', '.tmp-' + base + '.bin-')
        return any(name.startswith(prefixes) for name in os.listdir(directory))

    def read(self, key):
        base = self._key(key)
        with self._directory() as fd:
            try:
                _require(not self._partials(fd, base))
                raw = self._read_file(fd, base + '.json', MAX_RECORD_BYTES)
                if raw is None:
                    _require(self._read_file(fd, base + '.bin', MAX_BYTES) is None)
                    return None
                return self._record(raw)
            except OSError:
                self._failed = True
                raise StoreError() from None

    def read_bytes(self, key):
        base = self._key(key)
        with self._directory() as fd:
            try:
                _require(not self._partials(fd, base))
                record = self._read_file(fd, base + '.json', MAX_RECORD_BYTES)
                raw = self._read_file(fd, base + '.bin', MAX_BYTES)
                _require(record is not None or raw is None)
                if record is not None:
                    self._record(record)
                return raw
            except OSError:
                self._failed = True
                raise StoreError() from None

    def commit(self, key, record, bytes=None):
        base = self._key(key)
        encoded = self._encode(record)
        _require(bytes is None or type(bytes) is builtins.bytes)
        _require(bytes is None or len(bytes) <= MAX_BYTES)
        with self._directory() as fd:
            try:
                _require(not self._partials(fd, base))
                old_record = self._read_file(fd, base + '.json', MAX_RECORD_BYTES)
                old_bytes = self._read_file(fd, base + '.bin', MAX_BYTES)
                if old_record is not None:
                    _require(old_record == encoded and old_bytes == bytes)
                    if bytes is not None:
                        self._sync_file(fd, base + '.bin')
                    self._sync_file(fd, base + '.json')
                    os.fsync(fd)
                    _require(self._read_file(fd, base + '.json', MAX_RECORD_BYTES) == encoded)
                    _require(self._read_file(fd, base + '.bin', MAX_BYTES) == bytes)
                    return
                _require(old_bytes is None)
                if bytes is not None:
                    self._publish(fd, base + '.bin', bytes)
                self._publish(fd, base + '.json', encoded)
            except OSError:
                self._failed = True
                raise StoreError() from None
