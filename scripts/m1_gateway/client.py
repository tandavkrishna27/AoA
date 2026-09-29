"""One private request over an explicitly configured absolute Unix socket."""

import socket
import os
import stat
import struct
import sys

from .protocol import (IO_TIMEOUT, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ProtocolError,
                       deadline, decode_request, decode_response, encode,
                       receive_response_frame, send_frame, validate_socket_path,
                       validate_operation_timeout)


def request(socket_path: str, request: dict, *, timeout_ms: int = 5000,
            expected_server_uid=None, expected_socket_gid=None) -> dict:
    """No shell, environment path selection, Docker fallback, or stdout output.

    socket_path must be supplied by the approved caller configuration. Protected
    socket ownership/ancestor validation is part of Task4 startup integration.
    timeout_ms maps Task4's trusted caller timeoutMs configuration to an integer
    millisecond wait (1..2147483647) for the first response byte after sending.
    The five-second default preserves the development/library contract only;
    long operations require an explicit reviewed caller value. No production
    execution timeout is selected here. Connect/request and response framing
    each remain bounded to five seconds, independently of operation waiting.
    """
    validate_socket_path(socket_path)
    validate_operation_timeout(timeout_ms)
    if expected_server_uid is not None or expected_socket_gid is not None:
        if (sys.platform != 'linux' or type(expected_server_uid) is not int or expected_server_uid < 0
                or type(expected_socket_gid) is not int or expected_socket_gid < 0):
            raise ProtocolError('transport-error')
    raw = encode(request, MAX_REQUEST_BYTES)
    value = decode_request(raw)
    expires = deadline()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(IO_TIMEOUT)
            if expected_server_uid is not None:
                info = os.stat(socket_path, follow_symlinks=False)
                if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != expected_server_uid
                        or info.st_gid != expected_socket_gid or stat.S_IMODE(info.st_mode) != 0o660):
                    raise ProtocolError('transport-error')
            conn.connect(socket_path)
            if expected_server_uid is not None:
                pid, uid, _ = struct.unpack('3i', conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                after = os.stat(socket_path, follow_symlinks=False)
                if pid <= 0 or uid != expected_server_uid or (after.st_dev, after.st_ino) != (info.st_dev, info.st_ino):
                    raise ProtocolError('transport-error')
            send_frame(conn, raw, MAX_REQUEST_BYTES, expires)
            result = decode_response(receive_response_frame(conn, MAX_RESPONSE_BYTES, timeout_ms))
            if result['state'] != 'refused' and result['operationId'] != value['operationId']:
                raise ProtocolError('invalid-response')
            return result
    except (OSError, AttributeError):
        raise ProtocolError('transport-error') from None


def client_input(raw: bytes) -> dict:
    from .composition import strict_json, keys, integer
    value = strict_json(raw, MAX_REQUEST_BYTES + 4096)
    keys(value, ('schema', 'socketPath', 'timeoutMs', 'serverUid', 'socketGid', 'request'))
    if value['schema'] != 'm1a-gateway-client-v1': raise ProtocolError('invalid-request')
    validate_socket_path(value['socketPath'])
    validate_operation_timeout(value['timeoutMs'])
    integer(value['serverUid']); integer(value['socketGid'])
    decode_request(encode(value['request'], MAX_REQUEST_BYTES))
    return request(value['socketPath'], value['request'], timeout_ms=value['timeoutMs'],
                   expected_server_uid=value['serverUid'], expected_socket_gid=value['socketGid'])


def client_main() -> int:
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 4097)
        result = client_input(raw)
        sys.stdout.buffer.write(encode(result, MAX_RESPONSE_BYTES))
        return 0
    except Exception:
        sys.stderr.write('gateway-client-refused\n')
        return 1


if __name__ == '__main__': sys.exit(client_main())
