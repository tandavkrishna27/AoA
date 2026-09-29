"""Closed render-only journal records; no execution-v1 schema changes."""

from contextlib import contextmanager, ExitStack
import hashlib
import json
import os
import re

from .journal import (Journal, JournalError, MAX_RECORD_BYTES, _hash, _identifier,
                      _pairs, _require)


RENDER_STATES = frozenset(('accepted', 'dispatching', 'observed-success',
                           'observed-failure', 'outcome-unknown'))
RENDER_FIELDS = frozenset(('schema', 'mode', 'session', 'operationId', 'requestHash',
                           'profileSha256', 'inputIdentitySha256', 'state', 'result'))
VERDICT_FIELDS = frozenset(('schema', 'offlineOnly', 'renderSha256', 'profileSha256',
                            'services', 'scopedPass', 'dispatchDefaultRed',
                            'scopedCount', 'dispatchDefaultCount', 'code'))
VERDICT_CODES = frozenset(('OFFLINE_RENDER_CHECK_PASS', 'OFFLINE_RENDER_SCOPED_RED',
                           'OFFLINE_RENDER_CONTROL_MISSING'))
MARKER_FIELDS = frozenset(('schema', 'mode', 'session', 'operationId', 'requestHash',
                           'profileSha256', 'inputIdentitySha256', 'recordSha256'))


def _validate_verdict(value, profile_hash, expected_services):
    _require(type(value) is dict and set(value) == VERDICT_FIELDS)
    _require(value['schema'] == 'm1a-gateway-render-verdict-offline-v1'
             and value['offlineOnly'] is True)
    _hash(value['renderSha256'])
    _require(value['profileSha256'] == profile_hash)
    names = value['services']
    _require(type(names) is list and 1 <= len(names) <= 32)
    for name in names:
        _identifier(name)
    _require(names == expected_services)
    for key in ('scopedPass', 'dispatchDefaultRed'):
        _require(type(value[key]) is bool)
    for key in ('scopedCount', 'dispatchDefaultCount'):
        _require(type(value[key]) is int and 0 <= value[key] <= 255)
    _require(value['scopedPass'] == (value['scopedCount'] == 0)
             and value['dispatchDefaultRed'] == (value['dispatchDefaultCount'] > 0))
    expected = ('OFFLINE_RENDER_CHECK_PASS' if value['scopedPass'] and value['dispatchDefaultRed']
                else 'OFFLINE_RENDER_SCOPED_RED' if not value['scopedPass']
                else 'OFFLINE_RENDER_CONTROL_MISSING')
    _require(value['code'] in VERDICT_CODES and value['code'] == expected)


def validate_render_record(record, expected_services):
    _require(type(expected_services) is list and 1 <= len(expected_services) <= 32)
    for name in expected_services:
        _identifier(name)
    _require(expected_services == sorted(set(expected_services)))
    _require(type(record) is dict and set(record) == RENDER_FIELDS)
    _require(type(record['schema']) is int and record['schema'] == 2
             and record['mode'] == 'render-only')
    _identifier(record['session'])
    _identifier(record['operationId'])
    for key in ('requestHash', 'profileSha256', 'inputIdentitySha256'):
        _hash(record[key])
    state, result = record['state'], record['result']
    _require(type(state) is str and state in RENDER_STATES and type(result) is dict)
    if state in ('accepted', 'dispatching', 'outcome-unknown'):
        _require(result == {})
    else:
        _validate_verdict(result, record['profileSha256'], expected_services)
        _require((state == 'observed-success' and result['code'] == 'OFFLINE_RENDER_CHECK_PASS')
                 or (state == 'observed-failure' and result['code'] != 'OFFLINE_RENDER_CHECK_PASS'))
    return record


def render_transition(record, expected_services, state, result):
    validate_render_record(record, expected_services)
    _require(type(state) is str and type(result) is dict)
    _require((record['state'] == 'accepted' and state == 'dispatching')
             or (record['state'] == 'dispatching'
                 and state in ('observed-success', 'observed-failure', 'outcome-unknown')))
    return validate_render_record(record | {'state': state, 'result': dict(result)}, expected_services)


def render_marker(record, raw, expected_services):
    validate_render_record(record, expected_services)
    _require(record['state'] in ('observed-success', 'observed-failure') and type(raw) is bytes)
    canonical = json.dumps(record, allow_nan=False, separators=(',', ':')).encode('ascii')
    _require(raw == canonical)
    return dict(schema=1, mode='render-only', session=record['session'],
                operationId=record['operationId'], requestHash=record['requestHash'],
                profileSha256=record['profileSha256'],
                inputIdentitySha256=record['inputIdentitySha256'],
                recordSha256=hashlib.sha256(raw).hexdigest())


def validate_render_marker(marker, record, raw, expected_services):
    _require(type(marker) is dict and set(marker) == MARKER_FIELDS)
    _require(type(marker['schema']) is int)
    _require(marker == render_marker(record, raw, expected_services))
    return marker


class RenderJournal(Journal):
    """Disjoint render-v2 storage; a terminal is replayable only with its marker."""

    def __init__(self, root, expected_services):
        _require(type(expected_services) is list and 1 <= len(expected_services) <= 32)
        for name in expected_services:
            _identifier(name)
        _require(expected_services == sorted(set(expected_services)))
        self.expected_services = list(expected_services)
        self._active = set()
        super().__init__(root)

    @staticmethod
    def _raw(record):
        raw = json.dumps(record, allow_nan=False, separators=(',', ':')).encode('ascii')
        _require(len(raw) <= MAX_RECORD_BYTES)
        return raw

    def _read_json(self, directory, name):
        with self._open_json(directory, name) as (value, raw, _):
            return value, raw

    @contextmanager
    def _open_json(self, directory, name):
        fd = self._open_file(directory, name)
        try:
            _require(os.fstat(fd).st_size <= MAX_RECORD_BYTES)
            chunks = bytearray()
            while len(chunks) <= MAX_RECORD_BYTES:
                part = os.read(fd, min(8192, MAX_RECORD_BYTES + 1 - len(chunks)))
                if not part:
                    break
                chunks.extend(part)
            _require(0 < len(chunks) <= MAX_RECORD_BYTES)
            raw = bytes(chunks)
            value = json.loads(raw.decode('utf-8'), object_pairs_hook=_pairs,
                               parse_constant=lambda _: _require(False))
            _require(type(value) is dict and raw == self._raw(value))
            yield value, raw, fd
        finally:
            os.close(fd)

    def _names(self, directory):
        operations = set()
        for name in os.listdir(directory):
            if name == '.lock':
                fd = self._open_file(directory, name)
                os.close(fd)
                continue
            match = re.fullmatch(r'([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.(claim|json|dispatch|terminal|commit)', name)
            _require(match is not None)
            _identifier(match.group(1))
            operations.add(match.group(1))
        return sorted(operations)

    def _current(self, directory, session, operation):
        names = set(os.listdir(directory))
        with ExitStack() as stack:
            claim_name = operation + '.claim'
            claim_fd = self._open_file(directory, claim_name)
            stack.callback(os.close, claim_fd)
            _require(os.fstat(claim_fd).st_size == 64)
            claim = os.read(claim_fd, 65).decode('ascii')
            _hash(claim)
            base_name = operation + '.json'
            base, _, base_fd = stack.enter_context(self._open_json(directory, base_name))
            validate_render_record(base, self.expected_services)
            _require(base['session'] == session and base['operationId'] == operation
                     and base['requestHash'] == claim and base['state'] == 'accepted')
            held = [(claim_name, claim_fd), (base_name, base_fd)]
            if operation + '.dispatch' not in names:
                _require(operation + '.terminal' not in names and operation + '.commit' not in names)
                record = base
            else:
                dispatch_name = operation + '.dispatch'
                dispatch, _, dispatch_fd = stack.enter_context(self._open_json(directory, dispatch_name))
                _require(dispatch == render_transition(base, self.expected_services, 'dispatching', {}))
                held.append((dispatch_name, dispatch_fd))
                if operation + '.commit' not in names:
                    if operation + '.terminal' in names:
                        fd = self._open_file(directory, operation + '.terminal')
                        stack.callback(os.close, fd)
                    record = render_transition(dispatch, self.expected_services, 'outcome-unknown', {})
                else:
                    terminal_name = operation + '.terminal'
                    terminal, terminal_raw, terminal_fd = stack.enter_context(
                        self._open_json(directory, terminal_name))
                    _require(terminal['state'] in ('observed-success', 'observed-failure'))
                    _require(terminal == render_transition(dispatch, self.expected_services,
                                                           terminal['state'], terminal['result']))
                    marker_name = operation + '.commit'
                    marker, _, marker_fd = stack.enter_context(self._open_json(directory, marker_name))
                    validate_render_marker(marker, terminal, terminal_raw, self.expected_services)
                    held.extend(((terminal_name, terminal_fd), (marker_name, marker_fd)))
                    record = terminal
            for name, fd in held:
                os.fsync(fd)
                current = os.stat(name, dir_fd=directory, follow_symlinks=False)
                observed = os.fstat(fd)
                _require((current.st_dev, current.st_ino) == (observed.st_dev, observed.st_ino))
            os.fsync(directory)
            return record

    def accept(self, session, id, request_hash, profile_hash, input_hash):
        _identifier(session)
        _identifier(id)
        for value in (request_hash, profile_hash, input_hash):
            _hash(value)
        with self.session_lock(session) as directory:
            names = set(os.listdir(directory))
            if any(id + suffix in names for suffix in ('.claim', '.json', '.dispatch',
                                                       '.terminal', '.commit')):
                record = self._current(directory, session, id)
                _require(record['requestHash'] == request_hash
                         and record['profileSha256'] == profile_hash
                         and record['inputIdentitySha256'] == input_hash)
                return record
            self._exclusive(directory, id + '.claim', request_hash.encode('ascii'))
            record = dict(schema=2, mode='render-only', session=session, operationId=id,
                          requestHash=request_hash, profileSha256=profile_hash,
                          inputIdentitySha256=input_hash, state='accepted', result={})
            validate_render_record(record, self.expected_services)
            self._exclusive(directory, id + '.json', self._raw(record))
            return record

    def transition(self, session, id, state, result):
        _identifier(id)
        with self.session_lock(session, create=False) as directory:
            current = self._current(directory, session, id)
            if state == 'dispatching':
                _require(current['state'] == 'accepted')
                dispatch = render_transition(current, self.expected_services, state, result)
                self._exclusive(directory, id + '.dispatch', self._raw(dispatch))
                self._active.add((session, id))
                return dispatch
            _require((session, id) in self._active and current['state'] == 'outcome-unknown')
            dispatch, _ = self._read_json(directory, id + '.dispatch')
            self._active.remove((session, id))
            if state == 'outcome-unknown':
                _require(result == {})
                return current
            terminal = render_transition(dispatch, self.expected_services, state, result)
            terminal_raw = self._raw(terminal)
            self._exclusive(directory, id + '.terminal', terminal_raw, sync_directory=False)
            marker = render_marker(terminal, terminal_raw, self.expected_services)
            self._exclusive(directory, id + '.commit', self._raw(marker))
            return terminal

    def lookup(self, session, id):
        _identifier(id)
        with self.session_lock(session, create=False) as directory:
            return self._current(directory, session, id)

    def recover(self):
        records = []
        with self._root_fd() as root:
            sessions = sorted(os.listdir(root))
        for session in sessions:
            with self.session_lock(session, create=False) as directory:
                for operation in self._names(directory):
                    records.append(self._current(directory, session, operation))
        return records
