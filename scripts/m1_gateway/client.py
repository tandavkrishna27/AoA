"""One private request over an explicitly configured absolute Unix socket."""

import socket

from .protocol import (IO_TIMEOUT, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ProtocolError,
                       deadline, decode_request, decode_response, encode,
                       receive_response_frame, send_frame, validate_socket_path,
                       validate_operation_timeout)


def request(socket_path: str, request: dict, *, timeout_ms: int = 5000) -> dict:
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
    raw = encode(request, MAX_REQUEST_BYTES)
    value = decode_request(raw)
    expires = deadline()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(IO_TIMEOUT)
            conn.connect(socket_path)
            send_frame(conn, raw, MAX_REQUEST_BYTES, expires)
            result = decode_response(receive_response_frame(conn, MAX_RESPONSE_BYTES, timeout_ms))
            if result['state'] != 'refused' and result['operationId'] != value['operationId']:
                raise ProtocolError('invalid-response')
            return result
    except (OSError, AttributeError):
        raise ProtocolError('transport-error') from None
