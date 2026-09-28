const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { isAbsolute, join } = require('node:path');

const job = process.env.M1A_PROBE_JOB;
const runId = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT;
const sha = process.env.GITHUB_SHA;
const state = process.env.GITHUB_STATE;
const out = process.env.M1A_PROBE_OUT;
if (!['alpha', 'beta'].includes(job) || process.env.GITHUB_JOB !== job ||
    !/^[1-9][0-9]*$/.test(runId ?? '') || !/^[1-9][0-9]*$/.test(attempt ?? '') ||
    !/^[a-f0-9]{40}$/.test(sha ?? '') || !state || !out || !isAbsolute(out)) {
  throw new Error('M1A_SYNTHETIC_PROBE_INPUT_REFUSED');
}

const marker = `${job}:${runId}:${attempt}`;
appendFileSync(state, `M1A_PROBE_MARKER=${marker}\n`);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${job}.json`), JSON.stringify({
  classification: 'M1A_SYNTHETIC_ONLY', runId, runAttempt: Number(attempt),
  logicalJob: job, headSha: sha,
}));
process.stdout.write(`M1A_PROBE_MAIN ${job} ${runId} ${attempt}\n`);
