import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('.', import.meta.url));

test('main emits synthetic identity and saves a post-action marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm1a-postrun-probe-'));
  try {
    const state = join(dir, 'state');
    const run = spawnSync(process.execPath, [join(root, 'main.cjs')], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STATE: state, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
        GITHUB_JOB: 'alpha', GITHUB_SHA: 'a'.repeat(40), M1A_PROBE_JOB: 'alpha', M1A_PROBE_OUT: dir },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /M1A_PROBE_MAIN alpha 123 2/);
    assert.match(readFileSync(state, 'utf8'), /M1A_PROBE_MARKER=alpha:123:2/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'alpha.json'), 'utf8')),
      { classification: 'M1A_SYNTHETIC_ONLY', runId: '123', runAttempt: 2, logicalJob: 'alpha', headSha: 'a'.repeat(40) });
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('post emits only the held synthetic marker', () => {
  const run = spawnSync(process.execPath, [join(root, 'post.cjs')], {
    encoding: 'utf8', env: { ...process.env, STATE_M1A_PROBE_MARKER: 'beta:123:2' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), 'M1A_PROBE_POST beta:123:2');
});

test('workflow is two-job inert branch-only and has no sensitive capabilities', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../../workflows/m1a-postrun-synthetic-probe.yml', import.meta.url)), 'utf8');
  const action = readFileSync(join(root, 'action.yml'), 'utf8');
  assert.match(workflow, /branches:\s*\n\s*- codex\/m1a-postrun-synthetic-probe/);
  assert.match(workflow, /\n  alpha:\s*\n/);
  assert.match(workflow, /\n  beta:\s*\n/);
  assert.equal((workflow.match(/\.\/\.github\/actions\/m1a-postrun-probe/g) ?? []).length, 2);
  assert.equal((workflow.match(/actions\/upload-artifact@/g) ?? []).length, 2);
  assert.match(action, /post:\s*post\.cjs/);
  for (const job of ['alpha', 'beta']) {
    const section = workflow.split(new RegExp(`\\n  ${job}:\\s*\\n`))[1]?.split(/\n  (?:alpha|beta):\s*\n/)[0];
    assert.ok(section, `missing ${job} job`);
    assert.ok(section.indexOf('name: Upload inert identity') < section.indexOf('name: Teardown marker'));
  }
  assert.doesNotMatch(workflow, /workflow_dispatch|secrets\.|ssh|aws|e2b|docker|environment:/i);
});
