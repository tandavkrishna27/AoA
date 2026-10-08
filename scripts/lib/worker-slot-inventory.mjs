import path from 'node:path';
export function evaluateWorkerSlotInvariants(compose, names) {
  const violations = [];
  const resources = new Map();
  const unique = (kind, value, name) => {
    if (!value) { violations.push(`${name}: missing slot ${kind}`); return; }
    const key = `${kind}:${value}`;
    if (resources.has(key)) violations.push(`${name}: shared slot ${kind} with ${resources.get(key)}`);
    resources.set(key, name);
  };
  for (const name of names) {
    const worker = compose.services?.[name]; const env = worker?.environment ?? {};
    if (!worker) { violations.push(`${name}: missing worker slot`); continue; }
    if (worker.deploy?.replicas !== 1) violations.push(`${name}: slot must have exactly one replica`);
    if (worker.deploy?.update_config?.order !== 'stop-first') violations.push(`${name}: slot update must stop-first`);
    if (env.AOA_WORKER_KEY_STORE_MODE !== 'file_record' || env.AOA_WORKER_SLOT_BINDING_DIR !== '/slot-binding'
      || env.AOA_WORKER_STATE_DIR !== '/worker' || env.AOA_WORKER_EVENT_OUTBOX_PATH !== '/worker/events.db'
      || env.AOA_WORKER_LEASE_CANDIDATE_PATH !== '/worker/lease-candidates.db'
      || env.AOA_WORKER_ENROLLMENT_CODE_FILE !== '/run/secrets/enrollment-ticket') violations.push(`${name}: missing guarded slot custody or durable paths`);
    if (!Array.isArray(worker.command) || !worker.command.some(arg => arg.endsWith('/bin/networked-host.js'))) violations.push(`${name}: guarded networked host command required`);
    const volumes = worker.volumes ?? [];
    const state = volumes.find(volume => volume?.target === '/worker');
    const binding = volumes.find(volume => volume?.target === '/slot-binding');
    if (state?.type !== 'volume' || compose.volumes?.[state.source]?.external !== true) violations.push(`${name}: explicitly provisioned external state volume required`);
    if (binding?.type !== 'bind' || binding.bind?.create_host_path !== false) violations.push(`${name}: independent binding mount must not auto-create its host path`);
    const ticket = (worker.secrets ?? []).find(secret => secret?.target === 'enrollment-ticket');
    unique('state volume', state?.source, name); unique('binding directory', binding?.source, name);
    unique('ticket reference', ticket?.source, name); unique('ticket file', compose.secrets?.[ticket?.source]?.file, name);
  }
  return violations;
}
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error('invalid inventory fields');
}
function endpoint(value) {
  if (typeof value !== 'string' || value.includes('$')) throw new Error('invalid endpoint');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('secure endpoint required');
}
function bindingKey(value) {
  if (typeof value !== 'string' || /[$\r\n\0]/.test(value) || value.length > 512
    || (!path.posix.isAbsolute(value) && !/^[A-Za-z]:[\\/]/.test(value)) || value.startsWith('//') || value.startsWith('\\\\')) throw new Error('invalid binding path');
  const windows = /^[A-Za-z]:/.test(value);
  return windows ? path.win32.normalize(value).replaceAll('\\', '/').toLowerCase() : path.posix.normalize(value);
}
export function validateWorkerSlotInventory(value) {
  exact(value, ['v', 'min', 'max', 'workerImage', 'controlPlaneUrl', 'providerUrl', 'slots']);
  if (value.v !== 1 || !Number.isInteger(value.min) || !Number.isInteger(value.max) || value.min < 1 || value.max > 1000
    || value.min > value.max || !Array.isArray(value.slots) || value.slots.length < value.min || value.slots.length > value.max) throw new Error('invalid fleet bounds');
  if (typeof value.workerImage !== 'string' || !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(value.workerImage)) throw new Error('digest-pinned image required');
  endpoint(value.controlPlaneUrl); endpoint(value.providerUrl);
  const seen = new Map(['slotId','targetId','bindingDir','volumeName','enrollmentSecret'].map(key => [key, new Set()]));
  for (const slot of value.slots) {
    exact(slot, ['slotId','organizationId','targetId','bindingDir','volumeName','enrollmentSecret','failureDomain']);
    if (![slot.slotId, slot.volumeName, slot.enrollmentSecret, slot.failureDomain].every(id => typeof id === 'string' && ID.test(id))
      || ![slot.organizationId, slot.targetId].every(id => typeof id === 'string' && UUID.test(id))) throw new Error('invalid slot identifiers');
    for (const [key, values] of seen) {
      const normalized = key === 'bindingDir' ? bindingKey(slot[key]) : key === 'targetId' ? slot[key].toLowerCase() : slot[key];
      if (values.has(normalized)) throw new Error(`duplicate slot ${key}`);
      if (key === 'bindingDir' && [...values].some(other => normalized.startsWith(other.replace(/\/$/, '')+'/') || other.startsWith(normalized.replace(/\/$/, '')+'/'))) throw new Error('duplicate or nested binding directory');
      values.add(normalized);
    }
  }
  return value;
}
export function renderWorkerSlots(value) {
  const inventory = validateWorkerSlotInventory(value);
  const slots = [...inventory.slots].sort((a,b) => a.slotId.localeCompare(b.slotId, 'en'));
  const services = Object.fromEntries(slots.map(slot => [slot.slotId, {
    image: inventory.workerImage,
    command: ['node', '/worker-net-app/dist/bin/networked-host.js'],
    environment: {
      AOA_WORKER_TARGET_SCOPE: 'organization', AOA_WORKER_KEY_STORE_MODE: 'file_record',
      AOA_WORKER_CONTROL_PLANE_URL: inventory.controlPlaneUrl, AOA_WORKER_PROVIDER_URL: inventory.providerUrl,
      AOA_WORKER_DISPATCH_ENABLED: '0', AOA_WORKER_STATE_DIR: '/worker',
      AOA_WORKER_SLOT_BINDING_DIR: '/slot-binding', AOA_WORKER_ENROLLMENT_CODE_FILE: '/run/secrets/enrollment-ticket',
      AOA_WORKER_EVENT_OUTBOX_PATH: '/worker/events.db', AOA_WORKER_LEASE_CANDIDATE_PATH: '/worker/lease-candidates.db',
    },
    labels: { 'com.aoa.failure-domain': slot.failureDomain, 'com.aoa.slot-id': slot.slotId },
    deploy: { replicas: 1, update_config: { parallelism: 1, order: 'stop-first' }, rollback_config: { parallelism: 1, order: 'stop-first' } },
    volumes: [{ type: 'volume', source: slot.volumeName, target: '/worker' },
      { type: 'bind', source: slot.bindingDir, target: '/slot-binding', bind: { create_host_path: false } }],
    secrets: [{ source: slot.enrollmentSecret, target: 'enrollment-ticket' }],
    read_only: true, security_opt: ['no-new-privileges:true'], cap_drop: ['ALL'],
    stop_grace_period: '120s', stop_signal: 'SIGTERM',
  }]));
  // JSON is a YAML subset accepted by Compose; never read or interpolate secret contents.
  return JSON.stringify({ services, volumes: Object.fromEntries(slots.map(slot => [slot.volumeName, { external: true }])),
    secrets: Object.fromEntries(slots.map(slot => [slot.enrollmentSecret, { file: slot.bindingDir.replace(/[/\\]$/, '')+'/enrollment.ticket' }])) }, null, 2)+'\n';
}
