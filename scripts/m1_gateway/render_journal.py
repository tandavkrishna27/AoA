"""Closed render-only journal records; no execution-v1 schema changes."""

from .journal import JournalError, _hash, _identifier, _require


RENDER_STATES = frozenset(('accepted', 'dispatching', 'observed-success',
                           'observed-failure', 'outcome-unknown'))
RENDER_FIELDS = frozenset(('schema', 'mode', 'session', 'operationId', 'requestHash',
                           'profileSha256', 'inputIdentitySha256', 'state', 'result'))
VERDICT_FIELDS = frozenset(('schema', 'offlineOnly', 'renderSha256', 'profileSha256',
                            'services', 'scopedPass', 'dispatchDefaultRed',
                            'scopedCount', 'dispatchDefaultCount', 'code'))
VERDICT_CODES = frozenset(('OFFLINE_RENDER_CHECK_PASS', 'OFFLINE_RENDER_SCOPED_RED',
                           'OFFLINE_RENDER_CONTROL_MISSING'))


def _validate_verdict(value, profile_hash, expected_services):
    _require(type(value) is dict and set(value) == VERDICT_FIELDS)
    _require(value['schema'] == 'm1a-gateway-render-verdict-offline-v1'
             and value['offlineOnly'] is True)
    _hash(value['renderSha256'])
    _require(value['profileSha256'] == profile_hash)
    names = value['services']
    _require(type(names) is list and 1 <= len(names) <= 32)
    for name in names:
        _identifier(name)
    _require(names == expected_services)
    for key in ('scopedPass', 'dispatchDefaultRed'):
        _require(type(value[key]) is bool)
    for key in ('scopedCount', 'dispatchDefaultCount'):
        _require(type(value[key]) is int and 0 <= value[key] <= 255)
    _require(value['scopedPass'] == (value['scopedCount'] == 0)
             and value['dispatchDefaultRed'] == (value['dispatchDefaultCount'] > 0))
    expected = ('OFFLINE_RENDER_CHECK_PASS' if value['scopedPass'] and value['dispatchDefaultRed']
                else 'OFFLINE_RENDER_SCOPED_RED' if not value['scopedPass']
                else 'OFFLINE_RENDER_CONTROL_MISSING')
    _require(value['code'] in VERDICT_CODES and value['code'] == expected)


def validate_render_record(record, expected_services):
    _require(type(expected_services) is list and 1 <= len(expected_services) <= 32)
    for name in expected_services:
        _identifier(name)
    _require(expected_services == sorted(set(expected_services)))
    _require(type(record) is dict and set(record) == RENDER_FIELDS)
    _require(type(record['schema']) is int and record['schema'] == 2
             and record['mode'] == 'render-only')
    _identifier(record['session'])
    _identifier(record['operationId'])
    for key in ('requestHash', 'profileSha256', 'inputIdentitySha256'):
        _hash(record[key])
    state, result = record['state'], record['result']
    _require(type(state) is str and state in RENDER_STATES and type(result) is dict)
    if state in ('accepted', 'dispatching', 'outcome-unknown'):
        _require(result == {})
    else:
        _validate_verdict(result, record['profileSha256'], expected_services)
        _require((state == 'observed-success' and result['code'] == 'OFFLINE_RENDER_CHECK_PASS')
                 or (state == 'observed-failure' and result['code'] != 'OFFLINE_RENDER_CHECK_PASS'))
    return record


def render_transition(record, expected_services, state, result):
    validate_render_record(record, expected_services)
    _require(type(state) is str and type(result) is dict)
    _require((record['state'] == 'accepted' and state == 'dispatching')
             or (record['state'] == 'dispatching'
                 and state in ('observed-success', 'observed-failure', 'outcome-unknown')))
    return validate_render_record(record | {'state': state, 'result': dict(result)}, expected_services)
