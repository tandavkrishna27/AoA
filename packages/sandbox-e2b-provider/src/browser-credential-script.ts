// Fixed guest program: credentials stay outside the exported output root.
export const WRITE_BROWSER_CREDENTIAL = `
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const root = '/home/user/.aoa/browser-session-credentials';
const input = JSON.parse(process.argv[1]);
(async () => {
  const metadata = await fs.lstat(root);
  if ((metadata.mode & 0o777) !== 0o700 || !metadata.isDirectory() || metadata.isSymbolicLink() || await fs.realpath(root) !== root) throw Error('unsafe credential directory');
  const bytes = Buffer.from(input.bytes, 'base64');
  const payload = JSON.parse(bytes.toString('utf8'));
  if (payload.requestId !== input.requestId || !(Date.parse(input.expiresAt) > Date.now()) || !(Date.parse(payload.expiresAt) > Date.now())) throw Error('expired credential');
  const temporary = root + '/.' + crypto.randomUUID() + '.tmp';
  const target = root + '/' + input.requestId + '.json';
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); } finally { await file.close(); }
    if (!(Date.parse(input.expiresAt) > Date.now()) || !(Date.parse(payload.expiresAt) > Date.now())) throw Error('expired credential');
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(() => {}); }
})().catch(() => { process.exitCode = 1; });
`;
