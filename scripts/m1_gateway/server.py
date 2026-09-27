"""Authenticated accept path; no listener/startup or production dispatcher yet."""

import socket
import struct
import sys

from .protocol import (MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ProtocolError,
                       deadline, decode_request, decode_response, encode,
                       receive_frame, refusal, send_frame)


def authenticate_peer(conn) -> int:
    """Read actual Linux kernel credentials before consuming any request bytes."""
    if sys.platform != 'linux' or not hasattr(socket, 'SO_PEERCRED'):
        raise ProtocolError('peer-authentication-unavailable')
    try:
        if conn.family != socket.AF_UNIX or conn.type != socket.SOCK_STREAM:
            raise ProtocolError('peer-authentication-unavailable')
        raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
        pid, uid, gid = struct.unpack('3i', raw)
        if pid <= 0 or uid < 0 or gid < 0:
            raise ProtocolError('peer-authentication-unavailable')
        return uid
    except (OSError, ValueError, struct.error, AttributeError):
        raise ProtocolError('peer-authentication-unavailable') from None


def _send_refusal(conn, code, expires):
    try:
        send_frame(conn, encode(refusal(code), MAX_RESPONSE_BYTES), MAX_RESPONSE_BYTES, expires)
    except (ProtocolError, OSError):
        # Disconnect/expired deadline cannot produce an alternate output channel.
        pass


def serve_accepted_connection(conn, session_lookup, handler) -> None:
    """Production accept delegate. There is deliberately no supplied-UID option.

    Task4's listener must call this function on each accepted connection and own
    connection closure. Lookup/handler come only from protected startup config.
    """
    expires = deadline()
    try:
        peer_uid = authenticate_peer(conn)
    except Exception:
        _send_refusal(conn, 'peer-authentication-unavailable', expires)
        return
    serve_connection(conn, peer_uid, session_lookup, handler)


def serve_connection(conn, peer_uid: int, session_lookup, handler) -> None:
    """Library seam for an already authenticated UID (supplied UIDs in tests only).

    session_lookup(uid) returns the exact session identifier or None.
    handler(uid, validated_request) returns a validated version-one response.
    Profile service/payload admission and durable effects belong to Tasks2-4.
    """
    expires = deadline()
    try:
        if type(peer_uid) is not int or peer_uid < 0:
            raise ProtocolError('unauthorized-peer')
        session = session_lookup(peer_uid)
        if type(session) is not str:
            raise ProtocolError('unauthorized-peer')
        value = decode_request(receive_frame(conn, MAX_REQUEST_BYTES, expires))
        if value['session'] != session:
            raise ProtocolError('unauthorized-session')
    except ProtocolError as error:
        _send_refusal(conn, error.code, expires)
        return
    except Exception:
        _send_refusal(conn, 'transport-error', expires)
        return
    try:
        output = handler(peer_uid, value)
    except Exception:
        _send_refusal(conn, 'handler-error', deadline())
        return
    # Handler execution has its own policy; never consume response framing time.
    expires = deadline()
    try:
        raw = encode(output, MAX_RESPONSE_BYTES)
        validated = decode_response(raw)
        if validated['state'] != 'refused' and validated['operationId'] != value['operationId']:
            raise ProtocolError('invalid-response')
    except Exception:
        _send_refusal(conn, 'invalid-response', expires)
        return
    try:
        send_frame(conn, raw, MAX_RESPONSE_BYTES, expires)
    except (ProtocolError, OSError):
        pass
