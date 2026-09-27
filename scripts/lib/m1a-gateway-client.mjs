import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const fail = () => { throw new Error('gateway-client-refused'); };
const require = (v) => { if (!v) fail(); };
const keys = (v, fields) => require(v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join() === [...fields].sort().join());
const id = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const absolute = (v, root = false) => typeof v === 'string' && v.startsWith('/') &&
  !v.startsWith('//') && !v.includes('\0') && !v.includes('\\') && path.posix.normalize(v) === v &&
  (v !== '/' || root) && (v === '/' || v.split('/').slice(1).every(p => p && p !== '.' && p !== '..'));
function parse(raw, maximum) {
  try {
    require(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= maximum);
    const v = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
    require(Buffer.from(JSON.stringify(v)).equals(raw));
    return v;
  } catch { fail(); }
}
export function validateClientCall(request, options) {
  keys(options, ['socketPath', 'timeoutMs']);
  require(absolute(options.socketPath) && Number.isSafeInteger(options.timeoutMs) &&
    options.timeoutMs > 0 && options.timeoutMs <= 2147483647);
  keys(request, ['version','session','operationId','operation','services','arguments']);
  require(request.version === 1 && id(request.session) && id(request.operationId) && request.operation === 'logs');
  require(Array.isArray(request.services) && request.services.length > 0 && request.services.length <= 32 &&
    request.services.every(id) && new Set(request.services).size === request.services.length);
  keys(request.arguments, ['limitBytes']);
  require(Number.isSafeInteger(request.arguments.limitBytes) && request.arguments.limitBytes > 0 &&
    request.arguments.limitBytes <= 1048576 && Buffer.byteLength(JSON.stringify(request)) <= 65536);
  return request;
}
export function decodeClientResponse(raw, operationId) {
  const v = parse(raw, 1114112);
  keys(v, ['version','operationId','state','exitCode','result']);
  require(v.version === 1 && v.result && typeof v.result === 'object' && !Array.isArray(v.result));
  if (v.state === 'refused') {
    keys(v.result, ['code']);
    require(v.operationId === null && v.exitCode === null && ['invalid-request','invalid-response','invalid-frame',
      'transport-error','unauthorized-peer','unauthorized-session','peer-authentication-unavailable','handler-error',
      'invalid-socket-path'].includes(v.result.code));
  } else {
    require(v.operationId === operationId);
    if (['accepted','dispatching','outcome-unknown'].includes(v.state)) require(v.exitCode === null);
    else if (v.state === 'observed-success') require(v.exitCode === 0);
    else require(v.state === 'observed-failure' && Number.isInteger(v.exitCode) && v.exitCode > 0 && v.exitCode <= 255);
    const s = v.result.streams;
    keys(s, ['available','complete','stdoutBase64','stderrBase64']);
    if (s.available === false) require(s.complete === false && s.stdoutBase64 === null && s.stderrBase64 === null);
    else {
      require(s.available === true && s.complete === true && ['observed-success','observed-failure'].includes(v.state));
      let size = 0;
      for (const text of [s.stdoutBase64, s.stderrBase64]) {
        require(typeof text === 'string' && text.length <= 87384);
        const bytes = Buffer.from(text, 'base64');
        require(bytes.toString('base64') === text); size += bytes.length;
      }
      require(size <= 65536);
    }
  }
  return v;
}

function installation(options) {
  require(process.platform === 'linux');
  const info = fs.fstatSync(3);
  require(info.isFile() && info.size > 0 && info.size <= 262144);
  const raw = Buffer.alloc(info.size);
  require(fs.readSync(3, raw, 0, raw.length, 0) === raw.length);
  const value = parse(raw, 262144);
  keys(value, ['schema','python','moduleLoader','cwd','socketPath','serverUid','socketGid','ancestors','closure']);
  require(value.schema === 'm1a-gateway-client-installation-v1' && value.socketPath === options.socketPath &&
    absolute(value.cwd) && Array.isArray(value.ancestors) && Array.isArray(value.closure));
  require(value.ancestors.length > 0 && value.ancestors.length <= 256 && value.closure.length > 0 && value.closure.length <= 256);
  const ancestors = new Map();
  for (const pin of value.ancestors) {
    keys(pin, ['path','uid','gid','mode','device','inode']);
    require(absolute(pin.path, true) && !ancestors.has(pin.path));
    const st = fs.lstatSync(pin.path);
    require(st.isDirectory() && st.uid === pin.uid && st.gid === pin.gid &&
      (st.mode & 0o7777) === pin.mode && !(st.mode & 0o6022) && st.dev === pin.device && st.ino === pin.inode);
    ancestors.set(pin.path, pin);
  }
  require(ancestors.has('/') && ancestors.has(value.cwd));
  require(Number.isSafeInteger(value.serverUid) && value.serverUid >= 0 && Number.isSafeInteger(value.socketGid) && value.socketGid >= 0);
  let socketParent = path.posix.dirname(value.socketPath);
  const socketPin = ancestors.get(socketParent);
  require(socketPin && socketPin.mode === 0o710 && socketPin.uid === value.serverUid && socketPin.gid === value.socketGid);
  while (true) { require(ancestors.has(socketParent)); if (socketParent === '/') break; socketParent = path.posix.dirname(socketParent); }
  for (const pin of [value.python, value.moduleLoader, ...value.closure]) {
    keys(pin, ['path','uid','gid','mode','device','inode','size','sha256']);
    require(absolute(pin.path) && Number.isSafeInteger(pin.size) && pin.size > 0 && pin.size <= 16777216);
    let parent = path.posix.dirname(pin.path);
    while (true) { require(ancestors.has(parent)); if (parent === '/') break; parent = path.posix.dirname(parent); }
    const fd = fs.openSync(pin.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      require(st.isFile() && st.nlink === 1 && st.uid === pin.uid && st.gid === pin.gid &&
        (st.mode & 0o7777) === pin.mode && !(st.mode & 0o6022) && st.dev === pin.device && st.ino === pin.inode && st.size === pin.size);
      require(createHash('sha256').update(fs.readFileSync(fd)).digest('hex') === pin.sha256);
    } finally { fs.closeSync(fd); }
  }
  // The independent launcher protects import closure and these paths from swaps.
  return value;
}

export async function gatewayOperation(request, options) {
  try {
    validateClientCall(request, options);
    const install = installation(options);
    const input = Buffer.from(JSON.stringify({schema:'m1a-gateway-client-v1',socketPath:options.socketPath,
      timeoutMs:options.timeoutMs,serverUid:install.serverUid,socketGid:install.socketGid,request}));
    return await new Promise((resolve, reject) => {
      const child = spawn(install.python.path, ['-I','-S',install.moduleLoader.path],
        {env:{},cwd:install.cwd,shell:false,stdio:['pipe','pipe','pipe']});
      const chunks = []; let size = 0, errors = 0, done = false;
      const refuse = () => { if (!done) { done = true; clearTimeout(timer); child.kill(); reject(new Error('gateway-client-refused')); } };
      const timer = setTimeout(refuse, Math.min(options.timeoutMs + 15000, 2147483647));
      child.stdout.on('data', bytes => { size += bytes.length; if (size > 1114112) refuse(); else chunks.push(bytes); });
      child.stderr.on('data', bytes => { errors += bytes.length; if (errors > 64) refuse(); });
      child.on('error', refuse); child.stdin.on('error', refuse);
      child.on('close', status => {
        if (done) return;
        try {
          require(status === 0 && errors === 0);
          const result = decodeClientResponse(Buffer.concat(chunks), request.operationId);
          done = true; clearTimeout(timer); resolve(result);
        } catch { refuse(); }
      });
      child.stdin.end(input);
    });
  } catch { fail(); }
}
