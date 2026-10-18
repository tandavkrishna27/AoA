// Run: AOA_W13_REALTIME=1 node --import tsx --test --test-concurrency=1 tests/d1/w13-authenticated-realtime.test.mjs
// Full quantitative RT lane: additionally AOA_W13_REALTIME_FULL=1 (15+ minutes).
// Uses an isolated embedded real PostgreSQL cluster and two separate processes.
// Authenticated agent sockets are real; provider journeys and D4 are separate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyPendingMigrations, createDb } from '../../packages/db/src/index.ts';
import { sql } from 'drizzle-orm';
import { allocateEmbeddedPgPort } from '../../server/src/__tests__/helpers/embedded-pg-port.ts';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { WebSocket } = require('ws');
const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve('embedded-postgres')).href);
const full = process.env.AOA_W13_REALTIME_FULL === '1';
const FULL_OUTAGE_MS = 900_000;
const MAX_CATCHUP_MS = 300_000;
const FULL_SETUP_AND_WORKLOAD_ALLOWANCE_MS = 600_000;
const TEST_BUDGET_MS = full ? FULL_OUTAGE_MS + MAX_CATCHUP_MS + FULL_SETUP_AND_WORKLOAD_ALLOWANCE_MS : 240_000;
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < deadline, `Timed out: ${label}`); await pause(20); }
}
function launch(url) {
  const child = fork(fileURLToPath(new URL('./lib/w13-realtime-replica.mjs', import.meta.url)), [], {
    env: { ...process.env, AOA_W13_DATABASE_URL: url }, execArgv: ['--import', 'tsx'], silent: true,
  });
  let serial = 0, stderr = '';
  const pending = new Map();
  child.stdout.on('data', () => {});
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Replica startup timed out: ' + stderr)), 60_000);
    child.on('message', m => {
      if (m.ready) { clearTimeout(timer); resolve(m.port); }
      else if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(m.error)) : p.resolve(m.result); }
    });
    child.once('exit', code => {
      clearTimeout(timer); reject(Error(`Replica exited ${code}: ${stderr}`));
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error(`Replica exited ${code}`)); }
    });
  });
  function command(action, options = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`Replica command timed out: ${action}`)); }, 180_000);
      pending.set(id, { resolve, reject, timer }); child.send({ id, action, ...options });
    });
  }
  return { child, ready, command };
}
async function connect(port, companyId, token, sinceSeq) {
  const frames = [], raw = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/companies/${companyId}/events/ws${sinceSeq === undefined ? '' : '?sinceSeq=' + sinceSeq}`, { headers: { Authorization: `Bearer ${token}` } });
  socket.on('message', data => { raw.push(String(data)); frames.push(JSON.parse(String(data))); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  return { socket, frames, raw };
}
async function denied(port, company, token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/companies/${company}/events/ws`, { headers: { Authorization: `Bearer ${token}` } });
  return new Promise((resolve, reject) => {
    socket.on('open', () => { socket.terminate(); reject(Error('Cross-tenant upgrade accepted')); });
    socket.on('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(response.statusCode); });
    socket.on('error', () => {});
  });
}
const durableFrames = client => client.frames.filter(f => Number.isFinite(f.seq));
const record = (companyId, index, payload = {}) => ({ companyId, eventId: randomUUID(), type: 'issue.status_changed', payload: { index, ...payload } });

test('W13 actual authenticated cross-process socket composition (bounded smoke unless FULL=1)', { skip: process.env.AOA_W13_REALTIME !== '1', timeout: TEST_BUDGET_MS }, async () => {
  let pg, db; const replicas = [], clients = []; const root = await mkdtemp(join(tmpdir(), 'aoa-w13-realtime-'));
  const started = Date.now();
  try {
    const port = await allocateEmbeddedPgPort();
    pg = new EmbeddedPostgres({ databaseDir: join(root, 'db'), user: 'test', password: 'test', port, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
    await pg.initialise(); await pg.start();
    const url = `postgres://test:test@localhost:${port}/postgres`;
    await applyPendingMigrations(url); db = createDb(url);
    const tenants = [];
    for (let i = 0; i < 2; i++) {
      const org = randomUUID(), company = randomUUID(), agent = randomUUID(), token = `aoa_w13_${randomUUID()}`;
      const keyHash = createHash('sha256').update(token).digest('hex');
      await db.execute(sql`INSERT INTO organizations (id,name,slug) VALUES (${org}, 'W13 isolated', ${'w13-' + org})`);
      await db.execute(sql`INSERT INTO companies (id,organization_id,name,issue_prefix) VALUES (${company},${org},'W13 tenant',${'W13' + i})`);
      await db.execute(sql`INSERT INTO agents (id,company_id,name,kind,status) VALUES (${agent},${company},'W13 authenticated agent','org','idle')`);
      await db.execute(sql`INSERT INTO agent_api_keys (id,agent_id,company_id,name,key_hash) VALUES (${randomUUID()},${agent},${company},'W13 test key',${keyHash})`);
      tenants.push({ org, company, agent, token });
    }
    const a = launch(url); replicas.push(a); const portA = await a.ready;
    const b = launch(url); replicas.push(b); const portB = await b.ready;
    assert.notEqual(a.child.pid, b.child.pid);
    assert.equal(await denied(portB, tenants[1].company, tenants[0].token), 403);
    assert.equal(await denied(portA, tenants[0].company, 'invalid-canary-token'), 403);
    for (const t of tenants) { t.client = await connect(portB, t.company, t.token); clients.push(t.client); }
    // Publish real durable rows through replica A's shipped store and broker wake;
    // replica B's separate LISTEN/drainer/authenticated WS composition sends them.
    const eventCount = full ? 10_000 : 200;
    const accepted = [];
    for (const t of tenants) {
      const expected = [];
      for (let i = 0; i < eventCount / 2; i += 100) {
        expected.push(...await a.command('append', { records: Array.from({ length: Math.min(100, eventCount / 2 - i) }, (_, j) => record(t.company, i + j)) }));
      }
      await until(() => durableFrames(t.client).length === expected.length, 'durable cross-replica delivery', 60_000);
      assert.deepEqual(durableFrames(t.client).map(f => f.eventId), expected.map(e => e.eventId));
      accepted.push(...expected);
      assert.ok(t.client.frames.every(f => !f.companyId || f.companyId === t.company), 'tenant event leakage');
    }
    const duplicateInjections = full ? 100 : 5;
    const before = durableFrames(tenants[0].client).length;
    for (let i = 0; i < duplicateInjections; i++) await b.command('redeliver', { companyId: tenants[0].company, sinceSeq: 0, limit: 1 });
    await pause(150); assert.equal(durableFrames(tenants[0].client).length, before);
    const reconnectGaps = full ? 100 : 5;
    for (let i = 0; i < reconnectGaps; i++) {
      const t = tenants[i % 2], cursor = durableFrames(t.client).at(-1).seq;
      t.client.socket.terminate();
      const [appended] = await a.command('append', { records: [record(t.company, 'gap-' + i)] });
      t.client = await connect(i % 2 ? portA : portB, t.company, t.token, cursor); clients.push(t.client);
      await until(() => durableFrames(t.client).some(f => f.eventId === appended.eventId), 'reconnect gap catchup');
      assert.deepEqual(durableFrames(t.client).map(f => f.seq), [appended.seq]);
    }
    // Literal broker listener + poll shutdown, durable writes stay accepted.
    await a.command('brokerStop'); await b.command('brokerStop');
    const outageStart = Date.now(); const outageWrites = [];
    for (const t of tenants) outageWrites.push(...await a.command('append', { records: Array.from({ length: 10 }, (_, i) => record(t.company, 'outage-' + i)), notify: false }));
    const outageMs = full ? FULL_OUTAGE_MS : 250;
    while (Date.now() - outageStart < outageMs) await pause(Math.min(1000, outageMs - (Date.now() - outageStart)));
    const measuredOutageMs = Date.now() - outageStart;
    const recoveryStart = Date.now(); await a.command('brokerStart'); await b.command('brokerStart');
    for (const t of tenants) await until(() => outageWrites.filter(w => w.companyId === t.company).every(w => durableFrames(t.client).some(f => f.eventId === w.eventId)), 'broker recovery catchup', MAX_CATCHUP_MS);
    const recoveryMs = Date.now() - recoveryStart;
    assert.ok(recoveryMs <= MAX_CATCHUP_MS);
    // A real same-company private thread and a real foreign thread both refuse
    // subscription and live/replay payload visibility for the tenant-A agent.
    const privateThread = randomUUID(), foreignThread = randomUUID(), publicThread = randomUUID();
    await db.execute(sql`INSERT INTO discussions (id,company_id,title,visibility,owner_user_id,created_by) VALUES (${privateThread},${tenants[0].company},'Private W13','private','other-user','w13-fixture')`);
    await db.execute(sql`INSERT INTO discussions (id,company_id,title,visibility,created_by) VALUES (${foreignThread},${tenants[1].company},'Foreign W13','company','w13-fixture')`);
    await db.execute(sql`INSERT INTO discussions (id,company_id,title,visibility,owner_user_id,created_by) VALUES (${publicThread},${tenants[0].company},'Authorized W13','company','w13-owner','w13-fixture')`);
    const canary = `thread-secret-${randomUUID()}`;
    const privateCursor = durableFrames(tenants[0].client).at(-1).seq;
    tenants[0].client.socket.send(JSON.stringify({ subscribe: privateThread }));
    tenants[0].client.socket.send(JSON.stringify({ subscribe: foreignThread }));
    tenants[0].client.socket.send(JSON.stringify({ subscribe: publicThread }));
    const subscriptionAuthorization = await (tenants[0].client.socket.url.includes(`:${portA}/`) ? a : b).command('subscriptionBarrier', { privateThread, foreignThread, publicThread });
    assert.equal(subscriptionAuthorization.resolved, true, 'authorization must settle before hidden events are published');
    const hidden = [privateThread, foreignThread].map(threadId => ({ ...record(tenants[0].company, 'hidden', { threadId, canary }), type: 'thread.entry.created' }));
    await a.command('append', { records: hidden });
    const [publicEvent] = await a.command('append', { records: [{ ...record(tenants[0].company, 'authorized-thread', { threadId: publicThread }), type: 'thread.entry.created' }] });
    await until(() => durableFrames(tenants[0].client).some(f => f.eventId === publicEvent.eventId), 'authorized thread live positive control');
    const [visible] = await a.command('append', { records: [record(tenants[0].company, 'rbac-positive-control')] });
    await until(() => durableFrames(tenants[0].client).some(f => f.eventId === visible.eventId), 'RBAC positive control');
    await pause(150);
    assert.ok(!tenants[0].client.raw.join('').includes(canary), 'live private/foreign thread disclosure');
    const replayDenied = await connect(portB, tenants[0].company, tenants[0].token, privateCursor); clients.push(replayDenied);
    await until(() => durableFrames(replayDenied).some(f => f.eventId === visible.eventId), 'authorized replay positive control');
    assert.ok(durableFrames(replayDenied).some(f => f.eventId === publicEvent.eventId), 'authorized thread replay positive control');
    assert.ok(!replayDenied.raw.join('').includes(canary), 'replay private/foreign thread disclosure');
    replayDenied.socket.terminate();
    // Real transport congestion: pause TCP reads, then enqueue 16 MiB of durable
    // hints. Never override bufferedAmount or replace the native socket.
    const t = tenants[0]; const slow = await connect(portB, t.company, t.token); clients.push(slow);
    slow.socket._socket.pause();
    const padding = 'x'.repeat(128 * 1024);
    await a.command('append', { records: Array.from({ length: 128 }, (_, i) => record(t.company, 'pressure-' + i, { padding })) });
    const pressure = await b.command('status');
    assert.ok(pressure.bufferedBytes.some(bytes => bytes > 1_048_576), 'native transport never reached the production backpressure threshold');
    slow.socket._socket.resume();
    await until(() => slow.frames.some(f => f.type === '__resume' && f.payload.resume === 'snapshot'), 'backpressure snapshot signal');
    slow.socket.terminate();
    await a.command('trim', { window: 3, companies: tenants.map(t => t.company) });
    const stale = await connect(portB, t.company, t.token, 0); clients.push(stale);
    await until(() => stale.frames.some(f => f.type === '__resume' && f.payload.resume === 'snapshot'), 'retention snapshot signal');
    // Credential canaries occur only in authentication headers. They must never
    // enter peer socket frames or the durable denial audit.
    const audit = await db.execute(sql`SELECT details FROM activity_log WHERE action = 'security.denied.live_events_upgrade'`);
    const evidenceText = JSON.stringify({ frames: clients.flatMap(c => c.raw), audit });
    for (const tenant of tenants) assert.ok(!evidenceText.includes(tenant.token));
    assert.ok(!evidenceText.includes('invalid-canary-token'));
    const report = { scope: full ? 'W13 quantitative realtime composition lane' : 'W13 bounded realtime composition smoke', fullD4Acceptance: false,
      candidate: process.env.AOA_W13_CANDIDATE ?? 'unattested_worktree', startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), testBudgetMs: TEST_BUDGET_MS,
      organizations: 2, replicas: 2, authenticated: true, durableEvents: eventCount, reconnectGaps, duplicateInjections,
      outageAcceptedWrites: outageWrites.length, brokerOutageMs: measuredOutageMs, catchupMs: recoveryMs,
      actualNativeBackpressure: true, snapshotRequired: true, credentialCanaryRedaction: true, privateAndForeignThreadDenials: true, durationMs: Date.now() - started,
      limits: ['isolated owner boot pool; no production RLS certification', 'no provider service_reconcile journey', 'no D4 72-hour continuity or D5 topology'] };
    const reportPath = process.env.AOA_W13_REALTIME_EVIDENCE ?? process.env.AOA_W13_REPORT;
    if (reportPath) {
      await writeFile(reportPath + '.raw.json', JSON.stringify({ accepted, outageWrites, subscriptionAuthorization, nativeBufferObservations: pressure,
        connections: clients.map((c, index) => ({ index, frames: c.frames.map(f => ({ type: f.type, companyId: f.companyId, seq: f.seq, eventId: f.eventId,
          payloadSha256: createHash('sha256').update(JSON.stringify(f.payload)).digest('hex') })) })) }, null, 2) + '\n', { flag: 'wx' });
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    }
    console.log(JSON.stringify(report));
  } finally {
    for (const c of clients) c.socket.terminate();
    for (const replica of replicas) {
      try { if (replica.child.connected) await replica.command('stop'); } catch { replica.child.kill(); }
    }
    if (db) await db.$client.end({ timeout: 5 });
    if (pg) await pg.stop();
    await rm(root, { recursive: true, force: true });
  }
});
