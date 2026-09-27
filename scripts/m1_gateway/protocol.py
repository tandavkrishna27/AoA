"""Closed version-one wire schemas and bounded, deadline-based framing."""

import base64
import binascii
import json
import math
import posixpath
import re
import struct
import time
import uuid

MAX_REQUEST_BYTES = 65536
MAX_RESPONSE_BYTES = 1048576 + 65536
IO_TIMEOUT = 5.0
IDENTIFIER = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', re.ASCII)
UUID = re.compile(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', re.ASCII)
LIFECYCLE = frozenset(('create', 'up', 'start', 'restart', 'unpause', 'stop', 'remove'))
STATES = frozenset(('accepted', 'dispatching', 'observed-success', 'observed-failure', 'outcome-unknown'))
REFUSAL_CODES = frozenset(('invalid-request', 'invalid-response', 'invalid-frame',
                           'transport-error', 'unauthorized-peer', 'unauthorized-session',
                           'peer-authentication-unavailable', 'handler-error', 'invalid-socket-path'))


class ProtocolError(ValueError):
    """Only fixed, non-reflecting codes cross the transport boundary."""

    def __init__(self, code='invalid-request'):
        self.code = code if code in REFUSAL_CODES else 'invalid-request'
        super().__init__(self.code)


def _require(condition, code='invalid-request'):
    if not condition:
        raise ProtocolError(code)


def _identifier(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


def _keys(value, keys):
    _require(type(value) is dict and set(value) == set(keys))


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def _finite_tree(value):
    if isinstance(value, str):
        value.encode('utf-8', errors='strict')
    elif isinstance(value, float):
        _require(math.isfinite(value))
    elif isinstance(value, dict):
        for key, item in value.items():
            _finite_tree(key)
            _finite_tree(item)
    elif isinstance(value, list):
        for item in value:
            _finite_tree(item)


def _parse(raw, maximum):
    _require(type(raw) is bytes and 0 < len(raw) <= maximum)
    try:
        value = json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=_pairs,
                           parse_constant=lambda _: _require(False))
        _require(type(value) is dict)
        _finite_tree(value)
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise ProtocolError() from None


def decode_request(raw: bytes) -> dict:
    value = _parse(raw, MAX_REQUEST_BYTES)
    _keys(value, ('version', 'session', 'operationId', 'operation', 'services', 'arguments'))
    _require(type(value['version']) is int and value['version'] == 1)
    _require(_identifier(value['session']) and _identifier(value['operationId']))
    services = value['services']
    _require(type(services) is list and 1 <= len(services) <= 32)
    _require(all(_identifier(service) for service in services))
    _require(len(set(services)) == len(services))
    op, args = value['operation'], value['arguments']
    _require(type(op) is str and type(args) is dict)
    if op in LIFECYCLE:
        _keys(args, ())
    elif op == 'kill':
        _keys(args, ('signal',))
        _require(args['signal'] in ('SIGKILL', 'SIGTERM'))
    elif op in ('exec', 'run'):
        _keys(args, ('payloadId', 'stdinBase64'))
        _require(_identifier(args['payloadId']))
        encoded = args['stdinBase64']
        _require(type(encoded) is str and len(encoded) <= 43692)
        try:
            decoded = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ProtocolError() from None
        _require(len(decoded) <= 32768)
    elif op == 'inspect':
        _keys(args, ('projection',))
        _require(args['projection'] in ('binding', 'topology', 'rollout'))
    elif op == 'logs':
        _keys(args, ('limitBytes',))
        _require(type(args['limitBytes']) is int and 1 <= args['limitBytes'] <= 1048576)
    elif op == 'apply-rollout':
        _keys(args, ('enabled', 'control'))
        enabled, control = args['enabled'], args['control']
        _require(type(enabled) is list and type(control) is str)
        _require(all(type(item) is str and UUID.fullmatch(item) for item in enabled))
        _require(UUID.fullmatch(control) is not None)
        normalized = [uuid.UUID(item) for item in enabled]
        _require(len(set(normalized)) == len(normalized) and uuid.UUID(control) not in normalized)
    else:
        raise ProtocolError()
    return value


def refusal(code: str) -> dict:
    _require(code in REFUSAL_CODES)
    return dict(version=1, operationId=None, state='refused', exitCode=None, result={'code': code})


def decode_response(raw: bytes) -> dict:
    try:
        value = _parse(raw, MAX_RESPONSE_BYTES)
        _keys(value, ('version', 'operationId', 'state', 'exitCode', 'result'))
        _require(type(value['version']) is int and value['version'] == 1)
        _require(type(value['result']) is dict)
        state, exit_code = value['state'], value['exitCode']
        _require(type(state) is str)
        if state == 'refused':
            _require(value['operationId'] is None and exit_code is None)
            _keys(value['result'], ('code',))
            _require(type(value['result']['code']) is str and value['result']['code'] in REFUSAL_CODES)
        else:
            _require(state in STATES and _identifier(value['operationId']))
            _require(exit_code is None or (type(exit_code) is int and 0 <= exit_code <= 255))
        return value
    except ProtocolError:
        raise ProtocolError('invalid-response') from None


def encode(value: dict, maximum: int) -> bytes:
    try:
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
        _require(len(raw) <= maximum)
        return raw
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ProtocolError() from None


def validate_socket_path(path: str) -> None:
    # This argument is approved controller/caller configuration, never request data.
    _require(type(path) is str and path.startswith('/') and not path.startswith('//')
             and '\x00' not in path and '\\' not in path
             and posixpath.normpath(path) == path and path != '/', 'invalid-socket-path')


def deadline() -> float:
    return time.monotonic() + IO_TIMEOUT


def _timeout(conn, expires):
    remaining = expires - time.monotonic()
    if remaining <= 0:
        raise ProtocolError('transport-error')
    conn.settimeout(min(IO_TIMEOUT, remaining))


def _read_exact(conn, count, expires):
    chunks = bytearray()
    while len(chunks) < count:
        _timeout(conn, expires)
        chunk = conn.recv(count - len(chunks))
        if not chunk:
            raise ProtocolError('transport-error')
        chunks.extend(chunk)
    return bytes(chunks)


def receive_frame(conn, maximum, expires):
    try:
        length = struct.unpack('!I', _read_exact(conn, 4, expires))[0]
        _require(0 < length <= maximum, 'invalid-frame')
        return _read_exact(conn, length, expires)
    except OSError:
        raise ProtocolError('transport-error') from None


def send_frame(conn, raw, maximum, expires):
    _require(type(raw) is bytes and 0 < len(raw) <= maximum, 'invalid-frame')
    try:
        _timeout(conn, expires)
        conn.sendall(struct.pack('!I', len(raw)) + raw)
    except OSError:
        raise ProtocolError('transport-error') from None
