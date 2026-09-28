"""Offline render-profile shape checks; not a production admission contract."""

import hashlib
import json
import re

from .protocol import IDENTIFIER


class RenderError(ValueError):
    def __init__(self):
        super().__init__('gateway-render-refused')


class RenderUnknown(ValueError):
    def __init__(self):
        super().__init__('gateway-render-outcome-unknown')


def render_profile_hash(profile):
    body = {key: value for key, value in profile.items() if key != 'profileSha256'}
    raw = json.dumps(body, sort_keys=True, ensure_ascii=True, allow_nan=False,
                     separators=(',', ':')).encode('ascii')
    return hashlib.sha256(raw).hexdigest()


def render_inputs_hash(inputs):
    body = {key: value for key, value in inputs.items() if key != 'inputIdentitySha256'}
    raw = json.dumps(body, sort_keys=True, ensure_ascii=True, allow_nan=False,
                     separators=(',', ':')).encode('ascii')
    return hashlib.sha256(raw).hexdigest()


def parse_render_profile_shape(profile):
    fields = {'schema', 'classification', 'controllerSha', 'candidate',
              'session', 'candidateUid', 'authorityFingerprint',
              'composeSha256', 'inputIdentitySha256', 'project', 'services', 'profileSha256'}
    if type(profile) is not dict or set(profile) != fields:
        raise RenderError()
    if (profile['schema'] != 'm1a-gateway-render-profile-offline-v1'
            or profile['classification'] != 'OFFLINE_TEST_ONLY'
            or any(type(profile[key]) is not str or not re.fullmatch('[0-9a-f]{40}', profile[key])
                   for key in ('controllerSha', 'candidate'))
            or any(type(profile[key]) is not str or not re.fullmatch('[0-9a-f]{64}', profile[key])
                   for key in ('authorityFingerprint', 'composeSha256', 'inputIdentitySha256', 'profileSha256'))
            or any(type(profile[key]) is not str or not IDENTIFIER.fullmatch(profile[key])
                   for key in ('session', 'project'))
            or type(profile['candidateUid']) is not int or profile['candidateUid'] <= 0):
        raise RenderError()
    services = profile['services']
    if type(services) is not list or not 1 <= len(services) <= 32:
        raise RenderError()
    names = []
    for service in services:
        if type(service) is not dict or set(service) != {'name', 'dependencies'}:
            raise RenderError()
        name, dependencies = service['name'], service['dependencies']
        if (type(name) is not str or not IDENTIFIER.fullmatch(name)
                or type(dependencies) is not list or len(dependencies) > 32
                or any(type(dep) is not str or not IDENTIFIER.fullmatch(dep)
                       for dep in dependencies)
                or dependencies != sorted(set(dependencies))):
            raise RenderError()
        names.append(name)
    if names != sorted(set(names)) or any(
            service['name'] in service['dependencies']
            or not set(service['dependencies']) <= set(names)
            for service in services):
        raise RenderError()
    edges = {service['name']: service['dependencies'] for service in services}
    visited = set()
    def visit(name, active):
        if name in active:
            raise RenderError()
        if name in visited:
            return
        for dependency in edges[name]:
            visit(dependency, active | {name})
        visited.add(name)
    for name in names:
        visit(name, set())
    if profile['profileSha256'] != render_profile_hash(profile):
        raise RenderError()
    return names


def require_render_services(protected, supplied):
    if (type(protected) is not list or not 1 <= len(protected) <= 32
            or any(type(name) is not str or not IDENTIFIER.fullmatch(name)
                   for name in protected)
            or protected != sorted(set(protected))
            or type(supplied) is not list or supplied != protected):
        raise RenderError()


def render_compose(files, inputs, continuity, expected_input_identity):
    """Offline private capture primitive; no admission, persistence or socket route."""
    from . import composition

    try:
        fields = {'schema', 'mode', 'keyedValue', 'project', 'endpoint', 'dockerBinary', 'cwd', 'envFile',
                  'inputIdentitySha256',
                  'composeFiles', 'timeoutMs', 'maxStdoutBytes', 'maxStderrBytes'}
        if type(inputs) is not dict or set(inputs) != fields:
            raise RenderError()
        if (inputs['schema'] != 'm1a-gateway-render-inputs-offline-v1'
                or inputs['mode'] not in ('keyless', 'keyed')
                or inputs['project'] != 'aoa-m1-boot'
                or type(inputs['endpoint']) is not str
                or not inputs['endpoint'].startswith('unix://')):
            raise RenderError()
        if (type(expected_input_identity) is not str
                or not re.fullmatch('[0-9a-f]{64}', expected_input_identity)
                or inputs['inputIdentitySha256'] != expected_input_identity
                or render_inputs_hash(inputs) != expected_input_identity):
            raise RenderError()
        composition.absolute_path(inputs['endpoint'][7:])
        composition.absolute_path(inputs['cwd'])
        if inputs['mode'] == 'keyless' and inputs['keyedValue'] is not None:
            raise RenderError()
        if inputs['mode'] == 'keyed' and type(inputs['keyedValue']) is not dict:
            raise RenderError()
        pins = [inputs['dockerBinary'], inputs['envFile'], *inputs['composeFiles']]
        if inputs['mode'] == 'keyed':
            pins.append(inputs['keyedValue'])
        if type(inputs['composeFiles']) is not list or len(inputs['composeFiles']) != 2:
            raise RenderError()
        for pin in pins:
            composition.pin_schema(pin)
        if len({pin['path'] for pin in pins}) != len(pins):
            raise RenderError()
        environment = {}
        if inputs['mode'] == 'keyed':
            if inputs['keyedValue']['size'] > 4096:
                raise RenderError()
            value = files.read(inputs['keyedValue'], 4096).decode('ascii', 'strict')
            if not value or any(ord(char) < 33 or ord(char) > 126 for char in value):
                raise RenderError()
            environment = {'E2B_API_KEY': value}
        composition.integer(inputs['timeoutMs'], 1, 2147483647)
        composition.integer(inputs['maxStdoutBytes'], 1, 2097152)
        composition.integer(inputs['maxStderrBytes'], 1, 2097152)
        maximum = inputs['maxStdoutBytes'] + inputs['maxStderrBytes']
        if maximum > 2097152:
            raise RenderError()
        continuity()
        with files.directory(inputs['cwd']):
            for pin in pins:
                files.verify(pin)
    except Exception:
        raise RenderError() from None

    argv = [inputs['dockerBinary']['path'], '--host', inputs['endpoint'],
            'compose', '-p', inputs['project'], '--env-file', inputs['envFile']['path'],
            '-f', inputs['composeFiles'][0]['path'], '-f', inputs['composeFiles'][1]['path'],
            'config', '--format', 'json']
    def before_spawn():
        continuity()
        with files.directory(inputs['cwd']):
            for pin in pins:
                files.verify(pin)
            if inputs['mode'] == 'keyed' and files.read(inputs['keyedValue'], 4096).decode('ascii', 'strict') != environment['E2B_API_KEY']:
                raise RenderUnknown()
    try:
        output = composition.run_private(argv, cwd=inputs['cwd'], stdin=b'',
            timeout_ms=inputs['timeoutMs'], maximum=maximum,
            continuity=continuity, before_spawn=before_spawn,
            environment=environment)
        continuity()
        with files.directory(inputs['cwd']):
            for pin in pins:
                files.verify(pin)
        if (output['exitCode'] != 0 or len(output['stdout']) > inputs['maxStdoutBytes']
                or len(output['stderr']) > inputs['maxStderrBytes'] or output['stderr']):
            raise RenderUnknown()
        composition.strict_json(output['stdout'], inputs['maxStdoutBytes'])
        raw = output['stdout']
        return raw, hashlib.sha256(raw).hexdigest()
    except Exception:
        raise RenderUnknown() from None
