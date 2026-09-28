import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.m1_holder.store import Store, StoreError


class PartialMatcherTests(unittest.TestCase):
    def test_sibling_sequence_temporary_does_not_block_current_key(self):
        key = 'a' * 64
        with patch('scripts.m1_holder.store.os.listdir', return_value=[
            f'.tmp-{key}-10.bin-incomplete',
        ]):
            self.assertFalse(Store._partials(0, f'{key}-1'))
            self.assertTrue(Store._partials(0, f'{key}-10'))


@unittest.skipUnless(sys.platform == 'linux', 'requires Linux O_NOFOLLOW and directory fsync')
class StoreTests(unittest.TestCase):
    KEY = 'a' * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'private'
        self.root.mkdir(mode=0o700)

    def store(self):
        return Store(str(self.root))

    def test_missing_root_and_relative_root_refuse(self):
        with self.assertRaises(StoreError):
            Store(str(self.root / 'missing'))
        with self.assertRaises(StoreError):
            Store('private')

    def test_wrong_mode_owner_and_read_only_root_refuse(self):
        os.chmod(self.root, 0o755)
        with self.assertRaises(StoreError):
            self.store()
        os.chmod(self.root, 0o500)
        with self.assertRaises(StoreError):
            self.store()
        os.chmod(self.root, 0o700)
        store = self.store()
        store._owner_uid = os.geteuid() + 1
        with self.assertRaises(StoreError):
            store.read(self.KEY)

    def test_symlink_ancestor_and_leaf_refuse(self):
        link = Path(self.tmp.name) / 'link'
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(StoreError):
            Store(str(link))
        store = self.store()
        (self.root / (self.KEY + '.json')).symlink_to(self.root / 'missing')
        with self.assertRaises(StoreError):
            store.read(self.KEY)

    def test_traversal_and_invalid_keys_refuse(self):
        store = self.store()
        for key in ('../' + self.KEY, self.KEY + ':01', self.KEY + ':-1', self.KEY.upper()):
            with self.subTest(key=key), self.assertRaises(StoreError):
                store.read(key)

    def test_exact_replay_and_conflicting_bytes_refuse(self):
        store = self.store()
        record = {'schema': 1, 'name': 'ready'}
        store.commit(self.KEY, record, b'abc')
        self.assertEqual(store.read(self.KEY), record)
        self.assertEqual(store.read_bytes(self.KEY), b'abc')
        store.commit(self.KEY, {'name': 'ready', 'schema': 1}, b'abc')
        with self.assertRaises(StoreError):
            store.commit(self.KEY, record, b'changed')
        with self.assertRaises(StoreError):
            store.commit(self.KEY, {'schema': 2}, b'abc')

    def test_partial_temporary_file_refuses_commit(self):
        store = self.store()
        (self.root / ('.tmp-' + self.KEY + '.bin-partial')).write_bytes(b'partial')
        with self.assertRaises(StoreError):
            store.commit(self.KEY, {'schema': 1}, b'abc')

    def test_sibling_temporary_does_not_block_persisted_sequence(self):
        store = self.store()
        store.commit(self.KEY + ':1', {'schema': 1}, b'abc')
        (self.root / ('.tmp-' + self.KEY + '-10.bin-partial')).write_bytes(b'partial')
        self.assertEqual(store.read(self.KEY + ':1'), {'schema': 1})
        self.assertEqual(store.read_bytes(self.KEY + ':1'), b'abc')
        with self.assertRaises(StoreError):
            store.read(self.KEY + ':10')

    def test_replay_resyncs_existing_record_and_bytes_before_ack(self):
        store = self.store()
        record = {'schema': 1}
        store.commit(self.KEY, record, b'abc')
        synced = set()
        original_sync = os.fsync

        def capture_sync(fd):
            synced.add(os.readlink(f'/proc/self/fd/{fd}'))
            return original_sync(fd)

        with patch('scripts.m1_holder.store.os.fsync', side_effect=capture_sync):
            store.commit(self.KEY, record, b'abc')
        self.assertEqual(synced, {str(self.root), str(self.root / (self.KEY + '.json')),
                                  str(self.root / (self.KEY + '.bin'))})

    def test_replay_sync_failure_latches_store(self):
        store = self.store()
        store.commit(self.KEY, {'schema': 1}, b'abc')
        with patch('scripts.m1_holder.store.os.fsync', side_effect=OSError('synthetic')):
            with self.assertRaises(StoreError):
                store.commit(self.KEY, {'schema': 1}, b'abc')
        with self.assertRaises(StoreError):
            store.read(self.KEY)

    def test_interrupted_byte_publication_refuses_replay(self):
        store = self.store()
        path = self.root / (self.KEY + '.bin')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.write(fd, b'abc')
        os.close(fd)
        with self.assertRaises(StoreError):
            store.commit(self.KEY, {'schema': 1}, b'abc')

    def test_linked_temporary_file_refuses_replay(self):
        store = self.store()
        temporary = self.root / ('.tmp-' + self.KEY + '.json-incomplete')
        temporary.write_bytes(b'{"schema":1}')
        os.chmod(temporary, 0o600)
        os.link(temporary, self.root / (self.KEY + '.json'))
        with self.assertRaises(StoreError):
            store.commit(self.KEY, {'schema': 1})


if __name__ == '__main__':
    unittest.main()
