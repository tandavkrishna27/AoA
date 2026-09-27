import base64
import json
import unittest

from scripts.m1_gateway.protocol import ProtocolError, decode_request, decode_response


def valid_request(operation='up', arguments=None):
    return dict(version=1, session='campaign-1', operationId='op_1',
                operation=operation, services=['api'], arguments=arguments or {})


class ProtocolTests(unittest.TestCase):
    def decode(self, value):
        return decode_request(json.dumps(value).encode())

    def test_lifecycle_operations(self):
        for operation in ('create', 'up', 'start', 'restart', 'unpause', 'stop', 'remove'):
            with self.subTest(operation=operation):
                self.assertEqual(self.decode(valid_request(operation))['operation'], operation)

    def test_duplicate_keys_refused(self):
        for raw in (b'{"version":1,"version":1}',
                    json.dumps(valid_request()).replace('"arguments": {}', '"arguments": {"x":1,"x":2}').encode()):
            with self.assertRaises(ProtocolError):
                decode_request(raw)

    def test_unknown_argument_refused(self):
        with self.assertRaises(ProtocolError):
            self.decode(valid_request(arguments={'argv': ['secret']}))

    def test_65537_bytes_refused(self):
        with self.assertRaises(ProtocolError):
            decode_request(b' ' * 65537)
        raw = json.dumps(valid_request()).encode()
        self.assertEqual(decode_request(raw + b' ' * (65536 - len(raw))), valid_request())

    def test_invalid_utf8_refused(self):
        with self.assertRaises(ProtocolError):
            decode_request(b'\xff')

    def test_malformed_and_nonfinite_refused(self):
        for raw in (b'[]', b'null', b'{} trailing', b'{', b'{"x":NaN}',
                    b'{"x":Infinity}', b'{"x":1e999}', b'\xef\xbb\xbf{}',
                    b'{"x":"\\ud800"}', b'[' * 2000 + b']' * 2000):
            with self.subTest(raw=raw[:30]), self.assertRaises(ProtocolError):
                decode_request(raw)

    def test_closed_fields_and_types(self):
        mutations = [{'version': True}, {'version': 1.0}, {'version': 2},
                     {'session': 'a\n'}, {'session': 'caf\u00e9'}, {'operationId': '-op'},
                     {'session': 'a' * 65}, {'operationId': []},
                     {'operation': 'build'}, {'services': []}, {'services': ['api', 'api']},
                     {'services': ['api\n']}, {'services': 'api'},
                     {'services': ['s' + str(i) for i in range(33)]},
                     {'arguments': []}, {'authority': '/private/key'}, {'project': 'other'}]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ProtocolError):
                self.decode(valid_request() | mutation)
        for key in valid_request():
            value = valid_request()
            del value[key]
            with self.subTest(missing=key), self.assertRaises(ProtocolError):
                self.decode(value)

    def test_operation_argument_schemas(self):
        good = [('kill', {'signal': 'SIGTERM'}), ('kill', {'signal': 'SIGKILL'}),
                ('inspect', {'projection': 'binding'}), ('inspect', {'projection': 'topology'}),
                ('inspect', {'projection': 'rollout'}), ('logs', {'limitBytes': 1}),
                ('logs', {'limitBytes': 1048576}),
                ('exec', {'payloadId': 'probe', 'stdinBase64': ''}),
                ('run', {'payloadId': 'probe', 'stdinBase64': base64.b64encode(b'a' * 32768).decode()}),
                ('apply-rollout', {'enabled': ['12345678-1234-1234-1234-123456789abc'],
                                   'control': '87654321-4321-4321-4321-cba987654321'})]
        for op, args in good:
            with self.subTest(op=op, keys=list(args)):
                self.assertEqual(self.decode(valid_request(op, args))['arguments'], args)
        bad = [('kill', {'signal': 'TERM'}), ('inspect', {'projection': 'environment'}),
               ('logs', {'limitBytes': True}), ('logs', {'limitBytes': 0}),
               ('logs', {'limitBytes': 1048577}), ('logs', {'limitBytes': 2.0}),
               ('exec', {'payloadId': '../shell', 'stdinBase64': ''}),
               ('exec', {'payloadId': 'probe', 'stdinBase64': '!!'}),
               ('exec', {'payloadId': 'probe', 'stdinBase64': 1}),
               ('run', {'payloadId': 'probe', 'stdinBase64': base64.b64encode(b'a' * 32769).decode()}),
               ('apply-rollout', {'enabled': ['bad'], 'control': 'bad'}),
               ('apply-rollout', {'enabled': ['12345678-1234-1234-1234-123456789abc'] * 2,
                                  'control': '87654321-4321-4321-4321-cba987654321'}),
               ('apply-rollout', {'enabled': ['12345678-1234-1234-1234-123456789abc'],
                                  'control': '12345678-1234-1234-1234-123456789abc'})]
        for op, args in bad:
            with self.subTest(op=op, args=str(args)[:80]), self.assertRaises(ProtocolError):
                self.decode(valid_request(op, args))
        for op, args in good:
            for changed in (args | {'extra': 1}, {}):
                with self.subTest(op=op), self.assertRaises(ProtocolError):
                    self.decode(valid_request(op, changed))

    def test_response_closed_shape(self):
        good = dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
        self.assertEqual(decode_response(json.dumps(good).encode()), good)
        for change in ({'state': 'invented'}, {'exitCode': True}, {'exitCode': 256},
                       {'exitCode': -1}, {'result': []}, {'version': True},
                       {'operationId': None}, {'extra': 'secret'}):
            with self.subTest(change=change), self.assertRaises(ProtocolError):
                decode_response(json.dumps(good | change).encode())
        for state in ('accepted', 'dispatching', 'outcome-unknown'):
            self.assertEqual(decode_response(json.dumps(good | {'state': state, 'exitCode': None}).encode())['state'], state)
        self.assertEqual(decode_response(json.dumps(good | {'state': 'observed-failure', 'exitCode': 1}).encode())['exitCode'], 1)
        refused = dict(version=1, operationId=None, state='refused', exitCode=None,
                       result={'code': 'invalid-request'})
        self.assertEqual(decode_response(json.dumps(refused).encode()), refused)
        with self.assertRaises(ProtocolError):
            decode_response(json.dumps(refused | {'result': {'code': 'secret user input'}}).encode())

    def test_response_state_exit_invariant(self):
        base = dict(version=1, operationId='op_1', result={})
        for state in ('accepted', 'dispatching', 'outcome-unknown', 'observed-success', 'observed-failure'):
            for code in (None, 0, 1, 255, -1, 256, True, False, 0.0, 1.0, '1'):
                value = base | dict(state=state, exitCode=code)
                valid = ((state in ('accepted', 'dispatching', 'outcome-unknown') and code is None)
                         or (state == 'observed-success' and type(code) is int and code == 0)
                         or (state == 'observed-failure' and type(code) is int and 1 <= code <= 255))
                with self.subTest(state=state, code=code):
                    if valid:
                        self.assertEqual(decode_response(json.dumps(value).encode()), value)
                    else:
                        with self.assertRaises(ProtocolError) as caught:
                            decode_response(json.dumps(value).encode())
                        self.assertEqual(caught.exception.code, 'invalid-response')

    def test_response_size_and_strict_json(self):
        good = dict(version=1, operationId='op_1', state='observed-success', exitCode=0, result={})
        raw = json.dumps(good).encode()
        self.assertEqual(decode_response(raw + b' ' * (1114112 - len(raw))), good)
        for content in (raw + b' ' * (1114113 - len(raw)), b'\xff',
                        raw.replace(b'"result": {}', b'"result": {"x":1,"x":2}'),
                        raw.replace(b'"result": {}', b'"result": {"x":NaN}')):
            with self.assertRaises(ProtocolError) as caught:
                decode_response(content)
            self.assertEqual(caught.exception.code, 'invalid-response')


if __name__ == '__main__':
    unittest.main()
