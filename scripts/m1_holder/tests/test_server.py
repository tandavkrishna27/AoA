import base64
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

@unittest.skipUnless(sys.platform == 'linux', 'requires Linux fcntl')
class FrameLimitTests(unittest.TestCase):
    def test_blocked_success_reply_expires_before_complete_frame(self):
        from scripts.m1_holder import server
        class PartialSocket:
            def __init__(self):
                self.sent = 0
                self.blocking = None

            def setblocking(self, value):
                self.blocking = value

            def send(self, frame):
                self.sent += 1
                return 1

        conn = PartialSocket()
        with patch.object(server.select, 'select', side_effect=[
            ([], [conn], []), ([], [], []),
        ]):
            with self.assertRaises(TimeoutError):
                server._reply(conn, {'ok': True}, time.monotonic() + 1)
        self.assertIs(conn.blocking, False)
        self.assertEqual(conn.sent, 1)

    def test_one_mib_raw_chunk_fits_but_larger_raw_chunk_refuses(self):
        from scripts.m1_holder import server
        raw = b'a' * (1024 * 1024)
        encoded = base64.b64encode(raw).decode('ascii')
        request = json.dumps({'op': 'commit', 'key': 'a' * 64,
                              'record': {'v': 1}, 'bytes': encoded}).encode('ascii')
        self.assertLessEqual(len(request), server.MAX_FRAME)
        self.assertEqual(server._bytes(encoded), raw)
        with self.assertRaises(server.ProtocolError):
            server._bytes(base64.b64encode(raw + b'a').decode('ascii'))

    def test_declared_frame_above_transport_cap_refuses_before_payload(self):
        from scripts.m1_holder import server
        left, right = socket.socketpair()
        self.addCleanup(left.close)
        self.addCleanup(right.close)
        right.sendall(struct.pack('!I', server.MAX_FRAME + 1))
        with self.assertRaises(server.ProtocolError):
            server._request(left, time.monotonic() + 1)


@unittest.skipUnless(sys.platform == 'linux', 'requires Linux Unix credentials and flock')
class ServerTests(unittest.TestCase):
    KEY = 'a' * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.chmod(self.tmp.name, 0o710)
        self.root = Path(self.tmp.name) / 'private'
        self.root.mkdir(mode=0o700)
        self.socket_dir = Path(self.tmp.name) / 'socket'
        self.socket_dir.mkdir(mode=0o710)
        self.path = str(self.socket_dir / 'holder.sock')
        self.processes = []
        self.start()
        self.addCleanup(self.stop_all)

    def start(self, uid=None, gid=None, path=None, lease=2, timeout=0.4,
              production=False, crash=None, delay=0):
        path = path or self.path
        uid = os.getuid() if uid is None else uid
        gid = os.getgid() if gid is None else gid
        if production:
            args = [sys.executable, '-m', 'scripts.m1_holder.server', path,
                    str(self.root), str(uid), str(gid), str(timeout), str(lease)]
        else:
            script = '''
import os
import time
from scripts.m1_holder import server, store
crash = os.environ.get('HOLDER_TEST_CRASH')
delay = float(os.environ.get('HOLDER_TEST_DELAY', '0'))
if delay:
    original_commit = store.Store.commit
    def commit(self, *args):
        original_commit(self, *args)
        time.sleep(delay)
    store.Store.commit = commit
if crash:
    original = store.os.fsync
    count = 0
    def fsync(fd):
        global count
        count += 1
        original(fd)
        if count == int(crash):
            os._exit(47)
    store.os.fsync = fsync
server._serve(__import__('sys').argv[1], __import__('sys').argv[2],
              int(__import__('sys').argv[3]), int(__import__('sys').argv[4]),
              float(__import__('sys').argv[5]),
              float(__import__('sys').argv[6]), allow_same_uid=True)
'''
            args = [sys.executable, '-c', script, path, str(self.root),
                    str(uid), str(gid), str(timeout), str(lease)]
        proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                env={**os.environ, 'HOLDER_TEST_CRASH': str(crash or ''),
                                     'HOLDER_TEST_DELAY': str(delay)})
        self.processes.append(proc)
        for _ in range(100):
            if os.path.exists(path):
                return
            if proc.poll() is not None:
                self.fail(proc.stderr.read().decode())
            time.sleep(0.01)
        self.fail('server did not bind')

    def stop_all(self):
        for proc in self.processes:
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=3)
            proc.stderr.close()

    def connect(self, path=None):
        conn = socket.socket(socket.AF_UNIX)
        conn.settimeout(2)
        conn.connect(path or self.path)
        self.addCleanup(conn.close)
        return conn

    @staticmethod
    def request(conn, value):
        raw = json.dumps(value, separators=(',', ':')).encode()
        conn.sendall(struct.pack('!I', len(raw)) + raw)
        try:
            header = conn.recv(4, socket.MSG_WAITALL)
        except ConnectionResetError:
            return None
        if len(header) != 4:
            return None
        size = struct.unpack('!I', header)[0]
        return json.loads(conn.recv(size, socket.MSG_WAITALL))

    def test_lock_commit_read_and_conflict(self):
        conn = self.connect()
        self.assertEqual(self.request(conn, {'op': 'lock'}), {'ok': True})
        payload = base64.b64encode(b'abc').decode()
        body = {'op': 'commit', 'key': self.KEY, 'record': {'v': 1}, 'bytes': payload}
        self.assertEqual(self.request(conn, body), {'ok': True})
        self.assertEqual(self.request(conn, {'op': 'read', 'key': self.KEY}),
                         {'ok': True, 'value': {'v': 1}})
        self.assertEqual(self.request(conn, {'op': 'readBytes', 'key': self.KEY}),
                         {'ok': True, 'value': payload})
        self.assertEqual(self.request(conn, {**body, 'bytes': base64.b64encode(b'bad').decode()}),
                         {'ok': False})
        self.assertEqual(self.request(conn, {'op': 'unlock'}), {'ok': True})

    def test_oversized_existing_bytes_refuse_before_transport_read(self):
        from scripts.m1_holder.store import Store
        Store(str(self.root)).commit(self.KEY, {'v': 1}, b'a' * (1024 * 1024 + 1))
        conn = self.connect()
        self.assertEqual(self.request(conn, {'op': 'lock'}), {'ok': True})
        self.assertEqual(self.request(conn, {'op': 'readBytes', 'key': self.KEY}),
                         {'ok': False})

    def test_second_process_waits_and_eof_releases(self):
        second_path = str(Path(self.tmp.name) / 'second.sock')
        self.start(path=second_path)
        first = self.connect()
        second = self.connect(second_path)
        self.assertEqual(self.request(first, {'op': 'lock'}), {'ok': True})
        second.sendall(struct.pack('!I', 13) + b'{"op":"lock"}')
        second.settimeout(0.1)
        with self.assertRaises(socket.timeout):
            second.recv(4)
        first.close()
        second.settimeout(2)
        header = second.recv(4, socket.MSG_WAITALL)
        size = struct.unpack('!I', header)[0]
        self.assertEqual(json.loads(second.recv(size, socket.MSG_WAITALL)), {'ok': True})

    def test_stall_and_oversize_refuse(self):
        stalled = self.connect()
        stalled.sendall(struct.pack('!I', 100) + b'{')
        time.sleep(0.6)
        self.assertEqual(stalled.recv(1), b'')
        oversized = self.connect()
        oversized.sendall(struct.pack('!I', 100_000_000))
        self.assertEqual(oversized.recv(1), b'')
        malformed = self.connect()
        malformed.sendall(struct.pack('!I', 2) + b'{]')
        self.assertEqual(malformed.recv(1), b'')
        self.assertEqual(self.request(self.connect(), {'op': 'lock'}), {'ok': True})

    def test_first_frame_above_transport_cap_refuses(self):
        from scripts.m1_holder.server import MAX_FRAME
        conn = self.connect()
        conn.sendall(struct.pack('!I', MAX_FRAME + 1))
        self.assertEqual(conn.recv(1), b'')

    def test_connection_saturation_refuses_excess(self):
        from scripts.m1_holder.server import MAX_CONNECTIONS
        held = [self.connect() for _ in range(MAX_CONNECTIONS)]
        for conn in held:
            self.assertEqual(self.request(conn, {'op': 'invalid'}), {'ok': False})
        excess = self.connect()
        self.assertEqual(excess.recv(1), b'')

    def test_wrong_peer_refused_before_request(self):
        self.stop_all()
        os.unlink(self.path)
        self.start(uid=os.getuid() + 1)
        conn = self.connect()
        self.assertEqual(conn.recv(1), b'')

    def test_wrong_peer_gid_refused_before_request(self):
        groups = [group for group in os.getgroups() if group != os.getgid()]
        if not groups:
            self.skipTest('no alternate group available for a distinct socket group')
        self.stop_all()
        os.unlink(self.path)
        os.chown(self.tmp.name, -1, groups[0])
        os.chown(self.socket_dir, -1, groups[0])
        self.start(gid=groups[0])
        self.assertEqual(self.connect().recv(1), b'')

    def test_idle_lease_expires(self):
        self.stop_all()
        os.unlink(self.path)
        self.start(timeout=1, lease=0.2)
        first = self.connect()
        self.assertEqual(self.request(first, {'op': 'lock'}), {'ok': True})
        time.sleep(0.32)
        self.assertEqual(first.recv(1), b'')
        self.assertEqual(self.request(self.connect(), {'op': 'lock'}), {'ok': True})

    def test_production_rejects_same_uid_and_keeps_socket_absent(self):
        self.stop_all()
        os.unlink(self.path)
        proc = subprocess.run([sys.executable, '-m', 'scripts.m1_holder.server',
                               self.path, str(self.root), str(os.geteuid()),
                               str(os.getgid()), '0.4', '0.25'], capture_output=True)
        self.assertNotEqual(proc.returncode, 0)
        self.assertFalse(os.path.exists(self.path))

    def test_socket_permissions_and_private_root(self):
        self.assertEqual(os.stat(self.root).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(self.socket_dir).st_mode & 0o777, 0o710)
        info = os.stat(self.path)
        self.assertEqual(info.st_mode & 0o777, 0o660)
        self.assertEqual(info.st_gid, os.getgid())

    def test_wrong_socket_parent_mode_refuses(self):
        self.stop_all()
        os.unlink(self.path)
        os.chmod(self.socket_dir, 0o700)
        with self.assertRaises(AssertionError):
            self.start()

    def test_symlink_socket_parent_refuses(self):
        self.stop_all()
        os.unlink(self.path)
        link = Path(self.tmp.name) / 'link'
        link.symlink_to(self.socket_dir, target_is_directory=True)
        with self.assertRaises(AssertionError):
            self.start(path=str(link / 'holder.sock'))

    def test_queued_lock_does_not_get_fresh_deadline(self):
        self.stop_all()
        os.unlink(self.path)
        self.start(timeout=0.2, lease=1)
        first = self.connect()
        second = self.connect()
        self.assertEqual(self.request(first, {'op': 'lock'}), {'ok': True})
        second.sendall(struct.pack('!I', 13) + b'{"op":')
        time.sleep(0.15)
        second.sendall(b'"lock"}')
        time.sleep(0.1)
        first.close()
        second.settimeout(1)
        self.assertNotEqual(self.request_header(second), {'ok': True})

    @staticmethod
    def request_header(conn):
        header = conn.recv(4, socket.MSG_WAITALL)
        if not header:
            return None
        size = struct.unpack('!I', header)[0]
        return json.loads(conn.recv(size, socket.MSG_WAITALL))

    def test_late_operation_suppresses_ack_but_preserves_commit(self):
        self.stop_all()
        os.unlink(self.path)
        self.start(timeout=0.2, lease=1, delay=0.3)
        conn = self.connect()
        self.assertEqual(self.request(conn, {'op': 'lock'}), {'ok': True})
        self.assertIsNone(self.request(conn, {'op': 'commit', 'key': self.KEY,
                                               'record': {'v': 1}, 'bytes': 'YWJj'}))
        fresh = self.connect()
        self.assertEqual(self.request(fresh, {'op': 'lock'}), {'ok': True})
        self.assertEqual(self.request(fresh, {'op': 'readBytes', 'key': self.KEY}),
                         {'ok': True, 'value': 'YWJj'})

    def test_lease_expiry_during_commit_suppresses_ack(self):
        self.stop_all()
        os.unlink(self.path)
        self.start(timeout=1, lease=0.2, delay=0.3)
        conn = self.connect()
        self.assertEqual(self.request(conn, {'op': 'lock'}), {'ok': True})
        self.assertIsNone(self.request(conn, {'op': 'commit', 'key': self.KEY,
                                               'record': {'v': 1}, 'bytes': 'YWJj'}))
        fresh = self.connect()
        self.assertEqual(self.request(fresh, {'op': 'lock'}), {'ok': True})
        self.assertEqual(self.request(fresh, {'op': 'readBytes', 'key': self.KEY}),
                         {'ok': True, 'value': 'YWJj'})

    def test_crash_boundaries_do_not_ack(self):
        for point in range(1, 7):
            with self.subTest(fsync=point):
                self.stop_all()
                if os.path.exists(self.path):
                    os.unlink(self.path)
                self.start(crash=point)
                conn = self.connect()
                self.assertEqual(self.request(conn, {'op': 'lock'}), {'ok': True})
                key = f'{point:064x}'
                result = self.request(conn, {'op': 'commit', 'key': key,
                                             'record': {'v': point},
                                             'bytes': base64.b64encode(b'abc').decode()})
                self.assertIsNone(result)
                raw_final = self.root / (key + '.bin')
                record_final = self.root / (key + '.json')
                raw_temps = list(self.root.glob('.tmp-' + key + '.bin-*'))
                record_temps = list(self.root.glob('.tmp-' + key + '.json-*'))
                self.assertEqual(raw_final.exists(), point >= 2)
                self.assertEqual(record_final.exists(), point >= 5)
                self.assertEqual(len(raw_temps), int(point in (1, 2)))
                self.assertEqual(len(record_temps), int(point in (4, 5)))
                if raw_temps:
                    self.assertEqual(raw_temps[0].read_bytes(), b'abc')
                if point >= 2:
                    self.assertEqual(raw_final.read_bytes(), b'abc')
                if record_temps:
                    self.assertEqual(record_temps[0].read_bytes(),
                                     json.dumps({'v': point}, sort_keys=True,
                                                separators=(',', ':')).encode('ascii'))
                if point in (2, 5):
                    linked = raw_final if point == 2 else record_final
                    self.assertEqual(os.stat(linked).st_nlink, 2)
                self.stop_all()
                os.unlink(self.path)
                self.start()
                fresh = self.connect()
                self.assertEqual(self.request(fresh, {'op': 'lock'}), {'ok': True})
                replay = self.request(fresh, {'op': 'commit', 'key': key,
                                               'record': {'v': point}, 'bytes': 'YWJj'})
                self.assertEqual(replay, {'ok': point == 6})
                if point == 6:
                    self.assertEqual(self.request(fresh, {'op': 'readBytes', 'key': key}),
                                     {'ok': True, 'value': 'YWJj'})
                fresh.close()

    def test_restart_reads_persisted_bytes(self):
        conn = self.connect()
        self.assertEqual(self.request(conn, {'op': 'lock'}), {'ok': True})
        payload = base64.b64encode(b'exact').decode()
        self.assertEqual(self.request(conn, {'op': 'commit', 'key': self.KEY,
                                              'record': {'v': 1}, 'bytes': payload}), {'ok': True})
        self.stop_all()
        os.unlink(self.path)
        self.start()
        fresh = self.connect()
        self.assertEqual(self.request(fresh, {'op': 'lock'}), {'ok': True})
        self.assertEqual(self.request(fresh, {'op': 'readBytes', 'key': self.KEY}),
                         {'ok': True, 'value': payload})
        self.assertEqual(self.request(fresh, {'op': 'commit', 'key': self.KEY,
                                               'record': {'v': 1}, 'bytes': payload}), {'ok': True})
        self.assertEqual(self.request(fresh, {'op': 'commit', 'key': self.KEY,
                                               'record': {'v': 1}, 'bytes':
                                               base64.b64encode(b'different').decode()}), {'ok': False})


if __name__ == '__main__':
    unittest.main()
