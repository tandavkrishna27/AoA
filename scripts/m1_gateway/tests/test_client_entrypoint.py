import json
import stat
import struct
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from scripts.m1_gateway import client


class ClientEntrypointTests(unittest.TestCase):
    def test_entrypoint_input_closed_and_explicit_delivery_wait(self):
        req = dict(version=1, session='session1', operationId='op1', operation='logs',
                   services=['worker'], arguments={'limitBytes': 4})
        data = dict(schema='m1a-gateway-client-v1', socketPath='/protected/gateway.sock', timeoutMs=20000,
                    serverUid=101, socketGid=201, request=req)
        with patch.object(client, 'request', return_value={'private': 'result'}) as call:
            self.assertEqual(client.client_input(json.dumps(data).encode()), {'private': 'result'})
            call.assert_called_once_with('/protected/gateway.sock', req, timeout_ms=20000,
                                         expected_server_uid=101, expected_socket_gid=201)
        for changed in (data | {'python': '/evil'}, data | {'timeoutMs': True}, data | {'socketPath': '/'}):
            with self.subTest(changed=changed), patch.object(client, 'request') as call:
                with self.assertRaises(Exception): client.client_input(json.dumps(changed).encode())
                call.assert_not_called()

    def test_trusted_transport_refuses_wrong_socket_or_peer_before_send(self):
        req = dict(version=1, session='session1', operationId='op1', operation='logs',
                   services=['worker'], arguments={'limitBytes': 4})
        good = SimpleNamespace(st_mode=stat.S_IFSOCK | 0o660, st_uid=101, st_gid=201, st_dev=1, st_ino=2)
        for wrong_socket, peer, after in ((True, 101, good), (False, 102, good),
                (False, 101, SimpleNamespace(**(vars(good) | {'st_ino': 3})))):
            sock = MagicMock(); sock.__enter__.return_value = sock
            sock.getsockopt.return_value = struct.pack('3i', 1, peer, 201)
            initial = SimpleNamespace(**(vars(good) | {'st_uid': 102})) if wrong_socket else good
            with patch.object(client.sys, 'platform', 'linux'), patch.object(client.socket, 'SO_PEERCRED', 17, create=True), \
                    patch.object(client.socket, 'socket', return_value=sock), \
                    patch.object(client.os, 'stat', side_effect=[initial, after]), patch.object(client, 'send_frame') as send:
                with self.assertRaises(client.ProtocolError):
                    client.request('/protected/gateway.sock', req, expected_server_uid=101, expected_socket_gid=201)
                send.assert_not_called()
                if wrong_socket: sock.connect.assert_not_called()
