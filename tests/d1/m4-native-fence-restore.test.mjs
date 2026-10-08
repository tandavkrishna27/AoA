import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Full current application schema and real tenant-role fence guard. Native tools
// run in the owned PostgreSQL image so client/server versions always match. This
// is an engineering recovery regression, not live D5 topology or RPO/RTO proof.
test('native full-schema restore rejects stale fence authority', { timeout: 600000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aoa-m4-native-fence-'));
  const password = randomBytes(24).toString('hex');
  const owner = randomBytes(12).toString('hex');
  const containerName = `aoa-m4-native-fence-${owner}`;
  writeFileSync(path.join(directory, 'ownership.json'), JSON.stringify({ containerName, owner }));
  let id;
  function run(command, args, options = {}) {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024, ...options });
    if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr || result.stdout || result.error).replaceAll(password, '[redacted]').slice(-3000)}`);
    return result.stdout.trim();
  }
  try {
    id = run('docker', ['run', '-d', '--rm', '--name', containerName, '--label', `aoa.fixture.owner=${owner}`,
      '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=m4_fence_restore', '-p', '127.0.0.1::5432',
      'postgres@sha256:0027bef26712baaee437a4ea48fdf3d2d2e2bc5f0d81615374408ca320f3c7e3']);
    assert.match(id, /^[a-f0-9]{64}$/);
    for (let attempt = 0; attempt < 100; attempt++) {
      const ready = spawnSync('docker', ['exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'm4_fence_restore'], { timeout: 5000 });
      if (ready.status === 0) break;
      if (attempt === 99) throw new Error('Owned PostgreSQL fixture did not become TCP-ready');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const port = Number(run('docker', ['port', id, '5432/tcp']).split(':').at(-1));
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
    const wrappers = {};
    for (const tool of ['pg_dump', 'psql']) {
      const wrapper = path.join(directory, `${tool}.mjs`);
      writeFileSync(wrapper, `#!/usr/bin/env node
import { spawn } from 'node:child_process';
const id = process.env.AOA_DR_FIXTURE_CONTAINER_ID;
if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Missing owned fixture identity');
const args = process.argv.slice(2).map(arg => {
  if (!arg.startsWith('--dbname=')) return arg;
  const url = new URL(arg.slice('--dbname='.length));
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/m4_fence_restore') throw new Error('Wrong fixture destination');
  url.port = '5432';
  return '--dbname=' + url.toString();
});
const child = spawn('docker', ['exec', ${tool === 'psql' ? "'-i', " : ''}id, ${JSON.stringify(tool)}, ...args], { stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
`);
      chmodSync(wrapper, 0o700);
      wrappers[tool] = wrapper;
    }
    const report = path.join(directory, 'vitest-result.json');
    run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
      'server/src/__tests__/dr-stale-fence-after-restore.integration.test.ts',
      '-t', 'actual native backup/restore', '--reporter=json', `--outputFile=${report}`], {
      env: { ...process.env, AOA_DR_NATIVE_FIXTURE: 'owned-container-v1',
        AOA_DR_NATIVE_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/m4_fence_restore`,
        AOA_DR_FIXTURE_CONTAINER_ID: id, AOA_PG_DUMP_PATH: wrappers.pg_dump, AOA_PSQL_PATH: wrappers.psql },
    });
    const result = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(result.success, true);
    assert.equal(result.numPassedTests, 1, 'Selected native restore case must execute; a skip is not evidence');
    assert.equal(result.numFailedTests, 0);
    const artifactReport = path.join(directory, 'artifact-recovery-result.json');
    run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
      'server/src/__tests__/artifact-transfer-commit.integration.test.ts',
      '-t', 'recovered bytes stay quarantined', '--reporter=json', `--outputFile=${artifactReport}`], {
      env: { ...process.env, AOA_DR_NATIVE_FIXTURE: 'owned-container-v1',
        AOA_DR_NATIVE_DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${port}/m4_fence_restore`,
        AOA_DR_FIXTURE_CONTAINER_ID: id, AOA_PG_DUMP_PATH: wrappers.pg_dump, AOA_PSQL_PATH: wrappers.psql },
    });
    const artifacts = JSON.parse(readFileSync(artifactReport, 'utf8'));
    assert.equal(artifacts.success, true);
    assert.equal(artifacts.numPassedTests, 2, 'Both native DB + object fault cases must execute');
    assert.equal(artifacts.numFailedTests, 0);
    console.log(JSON.stringify({ result: 'PASS', passedNativeRestoreCases: 1,
      passedDatabaseAndObjectRecoveryCases: artifacts.numPassedTests,
      scenarios: ['post-snapshot lease', 'expired snapshot lease', 'generation cutoff in snapshot', 'post-backup revocation with pre-serving authority advance'],
      objectScenarios: ['restored bytes corrupted', 'restored bytes missing', 'healthy sibling still accessible'],
      limits: 'Disposable single-database + local-file engineering fixture; not live fleet, external object store or D5 timings' }));
  } finally {
    if (id && /^[a-f0-9]{64}$/.test(id)) run('docker', ['stop', '-t', '3', id], { timeout: 20000 });
  }
});
