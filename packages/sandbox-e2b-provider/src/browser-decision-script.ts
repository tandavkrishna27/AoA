// Fixed guest-only program. Caller data supplies only matched decision metadata.
export const WRITE_BROWSER_DECISION = `
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const root = '/home/user/.aoa/browser-approvals';
const body = JSON.parse(process.argv[1]);
(async () => {
  const metadata = await fs.lstat(root);
  if ((metadata.mode & 0o777) !== 0o700 || !metadata.isDirectory() || metadata.isSymbolicLink() || await fs.realpath(root) !== root) throw Error('unsafe approval directory');
  if (!(Date.parse(body.expiresAt) > Date.now())) throw Error('expired approval');
  const temporary = root + '/.' + crypto.randomUUID() + '.tmp';
  const target = root + '/' + body.requestId + '.json';
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(body)); } finally { await file.close(); }
    if (!(Date.parse(body.expiresAt) > Date.now())) throw Error('expired approval');
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(() => {}); }
})().catch(() => { process.exitCode = 1; });
`;
