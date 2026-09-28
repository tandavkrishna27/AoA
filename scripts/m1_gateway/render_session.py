"""Offline-only render coordination; never installed by the gateway factory."""

from copy import deepcopy
import hashlib
import json

from .journal import JournalError, _require
from .protocol import MAX_REQUEST_BYTES, decode_request, encode
from .render import RenderError, parse_render_profile_shape, require_render_services
from .render_journal import RenderJournal


def _response(record, available=False):
    state = record['state']
    result = record['result'] | {'renderAvailable': available} if state.startswith('observed-') else {}
    return dict(version=1, operationId=record['operationId'], state=state,
                exitCode=(0 if state == 'observed-success' else 1 if state == 'observed-failure' else None),
                result=result)


class OfflineRenderSession:
    """Fixture coordinator for the closed render path, with no production startup hook."""

    def __init__(self, profile, journal, capture, verify):
        protected = deepcopy(profile)
        names = parse_render_profile_shape(protected)
        _require(type(journal) is RenderJournal and journal.expected_services == names)
        _require(callable(capture) and callable(verify))
        self._profile_bytes = json.dumps(protected, sort_keys=True, allow_nan=False,
                                         separators=(',', ':')).encode('ascii')
        self.journal = journal
        self.capture = capture
        self.verify = verify

    def execute(self, request):
        try:
            protected = json.loads(self._profile_bytes.decode('ascii'))
            names = parse_render_profile_shape(protected)
            _require(self.journal.expected_services == names)
            raw_request = encode(request, MAX_REQUEST_BYTES)
            value = decode_request(raw_request)
            _require(value['operation'] == 'inspect'
                     and value['arguments'] == {'projection': 'render'}
                     and value['session'] == protected['session'])
            require_render_services(names, value['services'])
            request_hash = hashlib.sha256(json.dumps(
                value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('ascii')).hexdigest()
        except Exception:
            raise RenderError() from None
        session, operation = value['session'], value['operationId']
        with self.journal.session_lock(session):
            record = self.journal.accept(session, operation, request_hash,
                                         protected['profileSha256'],
                                         protected['inputIdentitySha256'])
            if record['state'] != 'accepted':
                return _response(record)
            self.journal.transition(session, operation, 'dispatching', {})
            try:
                raw = self.capture(deepcopy(protected))
                _require(type(raw) is bytes and 0 < len(raw) <= 1048576)
                verdict = self.verify(raw, deepcopy(protected))
                _require(type(verdict) is dict
                         and verdict.get('renderSha256') == hashlib.sha256(raw).hexdigest())
                state = ('observed-success' if verdict.get('code') == 'OFFLINE_RENDER_CHECK_PASS'
                         else 'observed-failure')
                terminal = self.journal.transition(session, operation, state, verdict)
                return _response(terminal, available=True)
            except Exception:
                try:
                    self.journal.transition(session, operation, 'outcome-unknown', {})
                except JournalError:
                    pass
                return dict(version=1, operationId=operation, state='outcome-unknown',
                            exitCode=None, result={})
