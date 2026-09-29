import json
import os
import socket
import struct
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from scripts.m1_gateway import client, server
from scripts.m1_gateway import protocol
from scripts.m1_gateway.protocol import ProtocolError
from test_protocol import valid_request


def frame(value):
    raw = json.dumps(value).encode()
    return struct.pack('!I', len(raw)) + raw


class MemoryConnection:
    def __init__(self, content=b'', fragment=3):
        self.content = content
        self.sent = b''
        self.fragment = fragment
        self.reads = 0
        self.timeouts = []

    def settimeout(self, timeout):
        self.timeouts.append(timeout)

    def recv(self, size):
        self.reads += 1
        data = self.content[:min(size, self.fragment)]
        self.content = self.content[len(data):]
        return data

    def sendall(self, data):
        self.sent += data


def response(conn):
    length = struct.unpack('!I', conn.sent[:4])[0]
    assert len(conn.sent[4:]) == length
    return json.loads(conn.sent[4:])


class ClockConnection(MemoryConnection):
    def __init__(self, content, clock, delays=()):
        super().__init__(content, fragment=1)
        self.clock = clock
        self.delays = iter(delays)
        self.connections = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def connect(self, path):
        self.connections += 1

    def recv(self, size):
        delay = next(self.delays, 0)
        if delay > self.timeouts[-1]:
            self.clock[0] += self.timeouts[-1]
            raise TimeoutError('private operation timeout')
        self.clock[0] += delay
        return super().recv(size)


class TransportTests(unittest.TestCase):
    def test_delayed_handler_has_fresh_response_deadline(self):
        for outcome in ('success', 'exception', 'invalid'):
            with self.subTest(outcome=outcome):
                clock, calls = [0.0], []
                conn = MemoryConnection(frame(valid_request()))
                def handler(*args):
                    calls.append(args)
                    clock[0] = 12.0
                    if outcome == 'exception':
                        raise RuntimeError('private handler text')
                    if outcome == 'invalid':
                        return dict(version=1, operationId='op_1', state='observed-failure', exitCode=0, result={})
                    return dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
                with patch.object(protocol.time, 'monotonic', side_effect=lambda: clock[0]):
                    server.serve_connection(conn, 42, lambda _: 'campaign-1', handler)
                self.assertEqual(len(calls), 1)
                self.assertTrue(conn.sent, 'delayed handler must still send a bounded response')
                result = response(conn)
                self.assertEqual(result['state'], 'observed-success' if outcome == 'success' else 'refused')
                if outcome != 'success':
                    self.assertEqual(result['result']['code'], 'handler-error' if outcome == 'exception' else 'invalid-response')
                self.assertEqual(conn.timeouts[-1], 5.0)
                self.assertNotIn(b'private', conn.sent)

    def test_client_operation_wait_then_fragment_deadline(self):
        good = dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
        clock = [0.0]
        conn = ClockConnection(frame(good), clock, [12, 1, 1, 1, 1])
        with patch.object(protocol.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(client.socket, 'socket', return_value=conn), patch.object(client.socket, 'AF_UNIX', 1, create=True):
            self.assertEqual(client.request('/protected/gateway.sock', valid_request(), timeout_ms=20000), good)
        self.assertEqual(conn.connections, 1)
        self.assertEqual(conn.timeouts[2:7], [20.0, 5.0, 4.0, 3.0, 2.0])
        self.assertEqual(json.loads(conn.sent[4:]), valid_request())

    def test_client_slow_header_and_body_share_five_seconds(self):
        good = dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
        for delays, reads in (([12, 2, 2, 2], 3), ([12, 0, 0, 0, 2, 2, 2], 6)):
            clock = [0.0]
            conn = ClockConnection(frame(good), clock, delays)
            with patch.object(protocol.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(client.socket, 'socket', return_value=conn), patch.object(client.socket, 'AF_UNIX', 1, create=True):
                with self.assertRaises(ProtocolError) as caught:
                    client.request('/protected/gateway.sock', valid_request(), timeout_ms=20000)
            self.assertEqual(caught.exception.code, 'transport-error')
            self.assertEqual(conn.reads, reads)
            self.assertEqual(clock[0], 17.0)
            self.assertEqual(conn.connections, 1)

    def test_client_operation_wait_expiry_never_retries(self):
        clock = [0.0]
        conn = ClockConnection(b'x', clock, [21])
        with patch.object(protocol.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(client.socket, 'socket', return_value=conn), patch.object(client.socket, 'AF_UNIX', 1, create=True):
            with self.assertRaises(ProtocolError) as caught:
                client.request('/protected/gateway.sock', valid_request(), timeout_ms=20000)
        self.assertEqual(caught.exception.code, 'transport-error')
        self.assertEqual(clock[0], 20.0)
        self.assertEqual(conn.connections, 1)
        self.assertEqual(json.loads(conn.sent[4:]), valid_request())

    def test_client_wait_configuration_validated_before_socket(self):
        for timeout in (None, True, False, 0, -1, 1.5, '20000', float('inf'), float('nan'), 2147483648):
            with self.subTest(timeout=timeout), patch.object(client.socket, 'socket', side_effect=AssertionError('must not connect')):
                with self.assertRaises(ProtocolError):
                    client.request('/protected/gateway.sock', valid_request(), timeout_ms=timeout)

    def test_client_library_wait_starts_after_request_send(self):
        good = dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
        clock = [0.0]
        conn = ClockConnection(frame(good), clock, [4])
        original_send = conn.sendall
        def send(data):
            original_send(data)
            clock[0] = 4.0
        conn.sendall = send
        with patch.object(protocol.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(client.socket, 'socket', return_value=conn), patch.object(client.socket, 'AF_UNIX', 1, create=True):
            self.assertEqual(client.request('/protected/gateway.sock', valid_request()), good)
        self.assertEqual(clock[0], 8.0)
        self.assertEqual(conn.timeouts[2], 5.0)
        self.assertEqual(conn.connections, 1)

    def test_operation_timeout_bounds_and_request_fields(self):
        good = dict(version=1, operationId='op_1', state='accepted', exitCode=None, result={})
        for timeout in (1, protocol.MAX_OPERATION_TIMEOUT_MS):
            clock = [0.0]
            conn = ClockConnection(frame(good), clock)
            with patch.object(client.socket, 'socket', return_value=conn), patch.object(client.socket, 'AF_UNIX', 1, create=True):
                self.assertEqual(client.request('/protected/gateway.sock', valid_request(), timeout_ms=timeout), good)
            self.assertEqual(conn.timeouts[2], timeout / 1000)
        for field in ('timeoutMs', 'timeout_ms', 'operationWait'):
            with patch.object(client.socket, 'socket', side_effect=AssertionError('must not connect')):
                with self.assertRaises(ProtocolError):
                    client.request('/protected/gateway.sock', valid_request() | {field: 20000})

    def test_response_invariant_enforced_on_both_transport_sides(self):
        base = dict(version=1, operationId='op_1', result={})
        for state, code in (('accepted', 0), ('dispatching', 1), ('outcome-unknown', 255),
                            ('observed-success', None), ('observed-success', 1),
                            ('observed-failure', None), ('observed-failure', 0),
                            ('observed-failure', True)):
            bad = base | dict(state=state, exitCode=code)
            with self.subTest(state=state, code=code):
                conn, calls = self.serve(frame(valid_request()), handler=lambda *_: bad)
                self.assertEqual(len(calls), 1)
                self.assertEqual(response(conn)['result'], {'code': 'invalid-response'})
                conn = ClockConnection(frame(bad), [0.0])
                with patch.object(client.socket, 'socket', return_value=conn), patch.object(client.socket, 'AF_UNIX', 1, create=True):
                    with self.assertRaises(ProtocolError) as caught:
                        client.request('/protected/gateway.sock', valid_request())
                self.assertEqual(caught.exception.code, 'invalid-response')
                self.assertEqual(conn.connections, 1)

    def serve(self, content, uid=42, session='campaign-1', handler=None):
        conn = MemoryConnection(content)
        calls = []
        def handle(peer, value):
            calls.append((peer, value))
            if handler:
                return handler(peer, value)
            return dict(version=1, operationId=value['operationId'],
                        state='observed-success', exitCode=0, result={})
        server.serve_connection(conn, uid, lambda peer: session if peer == 42 else None, handle)
        return conn, calls

    def test_fragmented_single_frame(self):
        conn, calls = self.serve(frame(valid_request()) + frame(valid_request()))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 42)
        self.assertEqual(response(conn)['state'], 'observed-success')
        self.assertTrue(conn.content)
        self.assertTrue(all(0 < timeout <= 5 for timeout in conn.timeouts))

    def test_peer_cannot_select_other_session(self):
        conn, calls = self.serve(frame(valid_request() | {'session': 'other'}))
        self.assertEqual(calls, [])
        self.assertEqual(response(conn), dict(version=1, operationId=None, state='refused',
                                             exitCode=None, result={'code': 'unauthorized-session'}))

    def test_unknown_peer_rejected_before_read(self):
        conn, calls = self.serve(frame(valid_request()), uid=99)
        self.assertEqual((conn.reads, calls), (0, []))
        self.assertEqual(response(conn)['result'], {'code': 'unauthorized-peer'})

    def test_parser_refusals_never_dispatch(self):
        for raw in (b'\xff', b'{"version":1,"version":1}', b'[]',
                    json.dumps(valid_request(arguments={'secret': 'value'})).encode()):
            conn, calls = self.serve(struct.pack('!I', len(raw)) + raw)
            self.assertEqual(calls, [])
            self.assertEqual(response(conn)['result'], {'code': 'invalid-request'})

    def test_oversized_header_refused_without_body_read(self):
        conn, calls = self.serve(struct.pack('!I', 65537) + b'private')
        self.assertEqual(calls, [])
        self.assertEqual(conn.content, b'private')
        self.assertEqual(response(conn)['result'], {'code': 'invalid-frame'})

    def test_zero_length_frame_refused(self):
        conn, calls = self.serve(struct.pack('!I', 0))
        self.assertEqual(calls, [])
        self.assertEqual(response(conn)['result'], {'code': 'invalid-frame'})

    def test_partial_frames_fixed_refusal(self):
        for raw in (b'', b'\x00', struct.pack('!I', 10) + b'{}'):
            conn, calls = self.serve(raw)
            self.assertEqual(calls, [])
            self.assertEqual(response(conn)['result'], {'code': 'transport-error'})

    def test_private_handler_and_response_errors(self):
        def explode(peer, value):
            raise RuntimeError('private-secret')
        for handler in (explode, lambda *_: {'secret': 'private-secret'},
                        lambda *_: dict(version=1, operationId='other', state='accepted', exitCode=None, result={}),
                        lambda *_: dict(version=1, operationId='op_1', state='accepted', exitCode=None,
                                        result={'logs': 'x' * (1048576 + 65536)})):
            conn, calls = self.serve(frame(valid_request()), handler=handler)
            self.assertEqual(len(calls), 1)
            self.assertEqual(response(conn)['state'], 'refused')
            self.assertNotIn(b'private-secret', conn.sent)

    def test_accept_authenticates_before_read(self):
        conn = MemoryConnection(frame(valid_request()))
        def authenticate(value):
            self.assertEqual(value.reads, 0)
            raise ProtocolError('peer-authentication-unavailable')
        with patch.object(server, 'authenticate_peer', authenticate):
            server.serve_accepted_connection(conn, lambda _: 'campaign-1', lambda *_: self.fail('dispatch'))
        self.assertEqual(conn.reads, 0)
        self.assertEqual(response(conn)['result'], {'code': 'peer-authentication-unavailable'})

    def test_unsupported_platform_fails_closed(self):
        with patch.object(server.sys, 'platform', 'win32'):
            with self.assertRaises(ProtocolError):
                server.authenticate_peer(MemoryConnection())

    def test_client_rejects_unapproved_path_before_socket(self):
        for path in ('relative.sock', '/tmp/../private.sock', 'C:/gateway.sock', '/tmp/a\x00b'):
            with patch.object(client.socket, 'socket', side_effect=AssertionError('must not connect')):
                with self.subTest(path=path), self.assertRaises(ProtocolError):
                    client.request(path, valid_request())

    def test_client_validates_response_and_request(self):
        good = dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
        class ClientConnection(MemoryConnection):
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def connect(self, path):
                self.path = path
        for value in (good, good | {'operationId': 'wrong'}, {'secret': 'value'}):
            conn = ClientConnection(frame(value))
            with patch.object(client.socket, 'AF_UNIX', 1, create=True), patch.object(client.socket, 'socket', return_value=conn):
                if value == good:
                    self.assertEqual(client.request('/protected/gateway.sock', valid_request()), good)
                    self.assertEqual(conn.path, '/protected/gateway.sock')
                    self.assertEqual(json.loads(conn.sent[4:]), valid_request())
                else:
                    with self.assertRaises(ProtocolError):
                        client.request('/protected/gateway.sock', valid_request())
        with patch.object(client.socket, 'socket', side_effect=AssertionError('must not connect')):
            with self.assertRaises(ProtocolError):
                client.request('/protected/gateway.sock', valid_request() | {'version': True})

    def test_client_unsupported_socket_fixed_error(self):
        with patch.object(client.socket, 'socket', side_effect=AttributeError('private platform detail')):
            with self.assertRaises(ProtocolError) as caught:
                client.request('/protected/gateway.sock', valid_request())
        self.assertEqual(caught.exception.code, 'transport-error')

    def test_timeout_is_fixed_and_bounded(self):
        conn = MemoryConnection()
        def timeout(size):
            raise TimeoutError('private timeout text')
        conn.recv = timeout
        server.serve_connection(conn, 42, lambda _: 'campaign-1', lambda *_: self.fail('dispatch'))
        self.assertEqual(response(conn)['result'], {'code': 'transport-error'})
        self.assertTrue(all(0 < value <= 5 for value in conn.timeouts))

    def test_slow_fragments_share_one_deadline(self):
        conn = MemoryConnection(frame(valid_request()), fragment=1)
        with patch.object(protocol.time, 'monotonic', side_effect=[0, 1, 4, 6, 7]):
            server.serve_connection(conn, 42, lambda _: 'campaign-1', lambda *_: self.fail('dispatch'))
        self.assertEqual(conn.reads, 2)
        self.assertEqual(conn.sent, b'')
        self.assertEqual(conn.timeouts, [4.0, 1.0])

    def test_disconnect_after_handler_has_no_second_dispatch(self):
        conn = MemoryConnection(frame(valid_request()))
        calls = []
        def disconnected(data):
            raise BrokenPipeError('private disconnect')
        conn.sendall = disconnected
        def handler(uid, value):
            calls.append(value)
            return dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
        server.serve_connection(conn, 42, lambda _: 'campaign-1', handler)
        self.assertEqual(len(calls), 1)

    def test_client_response_frame_limit_and_partial_read(self):
        class ClientConnection(MemoryConnection):
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def connect(self, path):
                pass
        for raw, code in ((struct.pack('!I', 1114113), 'invalid-frame'),
                          (struct.pack('!I', 20) + b'{}', 'transport-error')):
            with patch.object(client.socket, 'AF_UNIX', 1, create=True), patch.object(client.socket, 'socket', return_value=ClientConnection(raw)):
                with self.assertRaises(ProtocolError) as caught:
                    client.request('/protected/gateway.sock', valid_request())
                self.assertEqual(caught.exception.code, code)

    @unittest.skipUnless(sys.platform == 'linux' and hasattr(socket, 'SO_PEERCRED'),
                         'Linux SO_PEERCRED unavailable on this platform')
    def test_linux_real_socket_peer(self):
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        with left, right:
            self.assertEqual(server.authenticate_peer(left), os.getuid())

    @unittest.skipUnless(sys.platform == 'linux' and hasattr(socket, 'SO_PEERCRED'),
                         'Linux authenticated Unix-socket integration unavailable')
    def test_linux_real_client_server(self):
        with tempfile.TemporaryDirectory() as root:
            path = root + '/gateway.sock'
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                listener.bind(path)
                listener.listen(1)
                errors = []
                def accept():
                    try:
                        conn, _ = listener.accept()
                        with conn:
                            server.serve_accepted_connection(conn, lambda uid: 'campaign-1' if uid == os.getuid() else None,
                                lambda uid, value: dict(version=1, operationId=value['operationId'],
                                                        state='observed-success', exitCode=0, result={}))
                    except Exception as error:
                        errors.append(error)
                thread = threading.Thread(target=accept, daemon=True)
                thread.start()
                self.assertEqual(client.request(path, valid_request())['state'], 'observed-success')
                thread.join(6)
                self.assertFalse(thread.is_alive())
                self.assertEqual(errors, [])


if __name__ == '__main__':
    unittest.main()
