"""One private request over an explicitly configured absolute Unix socket."""

import socket

from .protocol import (MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ProtocolError,
                       deadline, decode_request, decode_response, encode,
                       receive_frame, send_frame, validate_socket_path)


def request(socket_path: str, request: dict) -> dict:
    """No shell, environment path selection, Docker fallback, or stdout output.

    socket_path must be supplied by the approved caller configuration. Protected
    socket ownership/ancestor validation is part of Task4 startup integration.
    """
    validate_socket_path(socket_path)
    raw = encode(request, MAX_REQUEST_BYTES)
    value = decode_request(raw)
    expires = deadline()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(5.0)
            conn.connect(socket_path)
            send_frame(conn, raw, MAX_REQUEST_BYTES, expires)
            result = decode_response(receive_frame(conn, MAX_RESPONSE_BYTES, expires))
            if result['state'] != 'refused' and result['operationId'] != value['operationId']:
                raise ProtocolError('invalid-response')
            return result
    except (OSError, AttributeError):
        raise ProtocolError('transport-error') from None
