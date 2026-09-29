"""Linux-only durable operation journal; no payloads, streams or reconciliation.

Callers must hold session_lock across authority checks, dispatch and result
integration. A dispatching transition must succeed before entering any effect.
Terminal metadata contains only exitCode, resourceIDs, configHash and
cleanupUncertainty. Task3 owns the authenticity of these observations.
"""

from contextlib import contextmanager
import json
import os
import posixpath
import re
import stat
import sys
import threading
import uuid

if sys.platform == 'linux':
    import fcntl
else:
    fcntl = None

from .protocol import IDENTIFIER, STATES

MAX_RECORD_BYTES = 65536
HASH = re.compile(r'[0-9a-f]{64}', re.ASCII)
FIELDS = frozenset(('schema', 'session', 'operationId', 'requestHash', 'state', 'exitCode', 'result'))
TERMINAL = frozenset(('observed-success', 'observed-failure', 'outcome-unknown'))
RESULT_FIELDS = frozenset(('exitCode', 'resourceIDs', 'configHash', 'cleanupUncertainty'))


class JournalError(ValueError):
    def __init__(self):
        super().__init__('journal-refused')


def _require(condition):
    if not condition:
        raise JournalError()


class _FailureLatch:
    def __init__(self):
        self.failed = False

    @contextmanager
    def guard(self):
        _require(not self.failed)
        try:
            yield
        except OSError:
            self.failed = True
            raise JournalError() from None


def _identifier(value):
    _require(type(value) is str and IDENTIFIER.fullmatch(value) is not None)


def _hash(value):
    _require(type(value) is str and HASH.fullmatch(value) is not None)


def _validate_record(record):
    _require(type(record) is dict and set(record) == FIELDS)
    _require(type(record['schema']) is int and record['schema'] == 1)
    _identifier(record['session'])
    _identifier(record['operationId'])
    _hash(record['requestHash'])
    state, result, code = record['state'], record['result'], record['exitCode']
    _require(type(state) is str and state in STATES and type(result) is dict)
    if state in ('accepted', 'dispatching') or (state == 'outcome-unknown' and result == {}):
        _require(code is None and result == {})
    else:
        _require('exitCode' in result and set(result) <= RESULT_FIELDS)
        if state == 'outcome-unknown':
            _require(code is None and result['exitCode'] is None)
        else:
            _require(type(code) is int and 0 <= code <= 255)
            _require(type(result['exitCode']) is int and result['exitCode'] == code)
            _require((state == 'observed-success' and code == 0)
                     or (state == 'observed-failure' and code != 0))
        if 'resourceIDs' in result:
            ids = result['resourceIDs']
            _require(type(ids) is list and len(ids) <= 32)
            for resource in ids:
                _identifier(resource)
            _require(len(set(ids)) == len(ids))
        if result.get('configHash') is not None:
            _hash(result['configHash'])
        if 'cleanupUncertainty' in result:
            _require(type(result['cleanupUncertainty']) is bool)
    return record


def _transition(record, state, result):
    _validate_record(record)
    _require(type(state) is str and type(result) is dict)
    _require((record['state'] == 'accepted' and state == 'dispatching')
             or (record['state'] == 'dispatching' and state in TERMINAL))
    return _validate_record(record | dict(state=state, result=dict(result), exitCode=result.get('exitCode')))


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        _require(key not in value)
        value[key] = item
    return value


def _identity(info):
    return info.st_dev, info.st_ino


def _directory(fd, private=False):
    info = os.fstat(fd)
    _require(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, os.geteuid())
             and not info.st_mode & 0o022)
    if private:
        _require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700)
    return info


def _file(fd):
    info = os.fstat(fd)
    _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1)
    return info


class Journal:
    def __init__(self, root: str):
        _require(sys.platform == 'linux' and fcntl is not None)
        _require(type(root) is str and root.startswith('/') and not root.startswith('//')
                 and '\x00' not in root and '\\' not in root and root != '/'
                 and posixpath.normpath(root) == root)
        self.root = root
        self._root_identity = None
        self._mutex = threading.RLock()
        self._held = {}
        self._failures = _FailureLatch()
        with self._root_fd() as fd:
            self._root_identity = _identity(os.fstat(fd))
        # Startup cannot leave interrupted dispatches eligible for another effect.
        self.recover()

    @contextmanager
    def _root_fd(self):
        with self._failures.guard():
            fd = None
            try:
                fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                _directory(fd)
                for part in self.root.split('/')[1:]:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd)
                    fd = child
                    _directory(fd)
                _directory(fd, private=True)
                if self._root_identity is not None:
                    _require(_identity(os.fstat(fd)) == self._root_identity)
                yield fd
            except (ValueError, TypeError):
                raise JournalError() from None
            finally:
                if fd is not None:
                    os.close(fd)

    def _open_file(self, directory, name, flags=os.O_RDONLY):
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            _file(fd)
            return fd
        except Exception:
            os.close(fd)
            raise

    def _read(self, directory, name):
        fd = self._open_file(directory, name)
        try:
            _require(os.fstat(fd).st_size <= MAX_RECORD_BYTES)
            chunks = bytearray()
            while len(chunks) <= MAX_RECORD_BYTES:
                data = os.read(fd, min(8192, MAX_RECORD_BYTES + 1 - len(chunks)))
                if not data:
                    break
                chunks.extend(data)
            _require(0 < len(chunks) <= MAX_RECORD_BYTES)
            return bytes(chunks)
        finally:
            os.close(fd)

    def _write_bytes(self, fd, raw):
        offset = 0
        while offset < len(raw):
            count = os.write(fd, raw[offset:])
            if count <= 0:
                raise OSError('journal-storage-failure')
            offset += count
        os.fsync(fd)

    def _exclusive(self, directory, name, raw, *, sync_directory=True):
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory)
        try:
            _file(fd)
            self._write_bytes(fd, raw)
        finally:
            os.close(fd)
        if sync_directory:
            os.fsync(directory)

    def _persist(self, directory, record):
        _validate_record(record)
        raw = json.dumps(record, allow_nan=False, separators=(',', ':')).encode('ascii')
        _require(len(raw) <= MAX_RECORD_BYTES)
        temporary = '.tmp-' + uuid.uuid4().hex
        # Temp files remain private on failure. They are never operation records.
        self._exclusive(directory, temporary, raw, sync_directory=False)
        os.replace(temporary, record['operationId'] + '.json', src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)

    @contextmanager
    def session_lock(self, session, *, create=True):
        """Reentrant exclusive flock, held by the caller through effect integration.

        Public use establishes a session, allowing accept inside the same lock.
        Storage failure poisons this instance; reopen/recovery is required.
        """
        _identifier(session)
        with self._mutex, self._failures.guard():
            directory = lock = None
            try:
                with self._root_fd() as root:
                    created = False
                    if create:
                        try:
                            os.mkdir(session, mode=0o700, dir_fd=root)
                            created = True
                            os.fsync(root)
                        except FileExistsError:
                            pass
                    directory = os.open(session, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
                    _directory(directory, private=True)
                    if session in self._held:
                        held_dir, held_lock = self._held[session]
                        _require(_identity(os.fstat(directory)) == _identity(os.fstat(held_dir)))
                        lock = self._open_file(directory, '.lock', os.O_RDWR)
                        _require(_identity(os.fstat(lock)) == _identity(os.fstat(held_lock)))
                        yield held_dir
                    else:
                        if created:
                            self._exclusive(directory, '.lock', b'1')
                        lock = self._open_file(directory, '.lock', os.O_RDWR)
                        fcntl.flock(lock, fcntl.LOCK_EX)
                        # A wait cannot bless directories/lock files replaced or
                        # made unsafe while the kernel lock was being acquired.
                        with self._root_fd() as checked_root:
                            current = os.stat(session, dir_fd=checked_root, follow_symlinks=False)
                            _require(_identity(current) == _identity(os.fstat(directory)))
                        current_lock = os.stat('.lock', dir_fd=directory, follow_symlinks=False)
                        _require(_identity(current_lock) == _identity(os.fstat(lock)))
                        _directory(directory, private=True)
                        _file(lock)
                        self._held[session] = (directory, lock)
                        try:
                            yield directory
                        finally:
                            del self._held[session]
            except (ValueError, TypeError, UnicodeError, RecursionError):
                raise JournalError() from None
            finally:
                if lock is not None:
                    os.close(lock)
                if directory is not None:
                    os.close(directory)

    def _record(self, directory, session, operation):
        claim = self._read(directory, operation + '.claim').decode('ascii')
        _hash(claim)
        record = json.loads(self._read(directory, operation + '.json').decode('utf-8'),
                            object_pairs_hook=_pairs,
                            parse_constant=lambda _: _require(False))
        _validate_record(record)
        _require(record['session'] == session and record['operationId'] == operation
                 and record['requestHash'] == claim)
        return record

    def accept(self, session, id, request_hash):
        _identifier(session)
        _identifier(id)
        _hash(request_hash)
        with self.session_lock(session) as directory:
            names = os.listdir(directory)
            if id + '.claim' in names or id + '.json' in names:
                record = self._record(directory, session, id)
                _require(record['requestHash'] == request_hash)
                # A previous directory-fsync failure must not earn a replay ACK
                # until both identity and record are durable again.
                for name in (id + '.claim', id + '.json'):
                    fd = self._open_file(directory, name)
                    try:
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                os.fsync(directory)
                return record
            self._exclusive(directory, id + '.claim', request_hash.encode('ascii'))
            record = dict(schema=1, session=session, operationId=id, requestHash=request_hash,
                          state='accepted', exitCode=None, result={})
            self._persist(directory, record)
            return record

    def transition(self, session, id, state, result):
        _identifier(id)
        with self.session_lock(session, create=False) as directory:
            record = _transition(self._record(directory, session, id), state, result)
            self._persist(directory, record)
            return record

    def lookup(self, session, id):
        _identifier(id)
        with self.session_lock(session, create=False) as directory:
            return self._record(directory, session, id)

    def session_records(self, session):
        """Validated snapshot of one existing session, with no recovery or effects.

        Reentrant under the dispatcher's outer session lock. Enumerate only that
        directory; a malformed outsider record cannot be read or confer custody.
        """
        _identifier(session)
        with self.session_lock(session, create=False) as directory:
            operations = set()
            for name in os.listdir(directory):
                if name == '.lock' or re.fullmatch(r'\.tmp-[0-9a-f]{32}', name):
                    fd = self._open_file(directory, name)
                    os.close(fd)
                    continue
                _require(name.endswith(('.json', '.claim')))
                operation = name.rsplit('.', 1)[0]
                _identifier(operation)
                operations.add(operation)
            return [self._record(directory, session, operation)
                    for operation in sorted(operations)]

    def recover(self):
        records = []
        with self._mutex, self._failures.guard():
            with self._root_fd() as root:
                sessions = sorted(os.listdir(root))
            for session in sessions:
                with self.session_lock(session, create=False) as directory:
                    operations = set()
                    for name in os.listdir(directory):
                        if name == '.lock' or re.fullmatch(r'\.tmp-[0-9a-f]{32}', name):
                            fd = self._open_file(directory, name)
                            os.close(fd)
                            continue
                        _require(name.endswith(('.json', '.claim')))
                        operation = name.rsplit('.', 1)[0]
                        _identifier(operation)
                        operations.add(operation)
                    for operation in sorted(operations):
                        record = self._record(directory, session, operation)
                        if record['state'] == 'dispatching':
                            record = _transition(record, 'outcome-unknown', {})
                            self._persist(directory, record)
                        records.append(record)
        return records
