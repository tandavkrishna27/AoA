import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('installation opens untrusted file type nonblocking before validation', async () => {
  const { gatewayOperation } = await import('../m1a-gateway-client.mjs');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const nonblock = Object.getOwnPropertyDescriptor(fs.constants, 'O_NONBLOCK');
  const original = { fstatSync:fs.fstatSync, readSync:fs.readSync, lstatSync:fs.lstatSync, openSync:fs.openSync };
  const directory = {uid:1,gid:2,mode:0o710,device:3,inode:4};
  const pin = {path:'/protected/python',uid:1,gid:2,mode:0o600,device:3,inode:5,size:1,sha256:'a'.repeat(64)};
  const raw = Buffer.from(JSON.stringify({schema:'m1a-gateway-client-installation-v1',python:pin,moduleLoader:pin,
    cwd:'/protected',socketPath:'/protected/gateway',serverUid:1,socketGid:2,
    ancestors:[{path:'/',...directory},{path:'/protected',...directory}],closure:[pin]}));
  let opened = false, nonblocking = false;
  try {
    Object.defineProperty(process, 'platform', {value:'linux'});
    if (!nonblock) fs.constants.O_NONBLOCK = 2048;
    fs.fstatSync = () => ({isFile:()=>true,size:raw.length});
    fs.readSync = (fd, target) => {raw.copy(target); return raw.length;};
    fs.lstatSync = () => ({isDirectory:()=>true,uid:1,gid:2,mode:0o710,dev:3,ino:4});
    fs.openSync = (filename, flags) => {opened=true; nonblocking=!!(flags & fs.constants.O_NONBLOCK); throw new Error('type fixture');};
    await assert.rejects(gatewayOperation({version:1,session:'session1',operationId:'op1',operation:'logs',
      services:['worker'],arguments:{limitBytes:4}}, {socketPath:'/protected/gateway',timeoutMs:1}), /gateway-client-refused/);
  } finally {
    Object.assign(fs, original); Object.defineProperty(process, 'platform', platform);
    if (!nonblock) delete fs.constants.O_NONBLOCK;
  }
  assert(opened, 'must reach protected file open');
  assert(nonblocking, 'FIFO open must not block before fstat');
});

test('Linux client rejects actual FIFO installation pin without a writer', {skip:process.platform !== 'linux'}, () => {
  const root=fs.mkdtempSync(path.join(os.homedir(),'.gateway-fifo-'));
  fs.chmodSync(root,0o710);
  try {
    const fifo=path.join(root,'python');
    const made=spawnSync('python3',['-I','-S','-c','import os,sys;os.mkfifo(sys.argv[1],0o600)',fifo],{timeout:5000});
    assert.equal(made.status,0,String(made.stderr));
    const loader=path.join(root,'loader'); fs.writeFileSync(loader,'x',{mode:0o600});
    const pin=filename=>{const st=fs.statSync(filename);return {path:filename,uid:st.uid,gid:st.gid,mode:st.mode&0o7777,
      device:st.dev,inode:st.ino,size:1,sha256:'a'.repeat(64)};};
    const ancestors=[];
    for(let dir=root;;dir=path.dirname(dir)) {
      const st=fs.statSync(dir);ancestors.push({path:dir,uid:st.uid,gid:st.gid,mode:st.mode&0o7777,device:st.dev,inode:st.ino});
      if(dir==='/')break;
    }
    const descriptor=path.join(root,'descriptor'),socketPath=path.join(root,'gateway');
    fs.writeFileSync(descriptor,JSON.stringify({schema:'m1a-gateway-client-installation-v1',python:pin(fifo),moduleLoader:pin(loader),
      cwd:root,socketPath,serverUid:process.getuid(),socketGid:process.getgid(),ancestors,closure:[pin(loader)]}),{mode:0o600});
    const fd=fs.openSync(descriptor,'r');
    let result;
    try {
      result=spawnSync(process.execPath,['--input-type=module','-e',
        `import {gatewayOperation} from ${JSON.stringify(new URL('../m1a-gateway-client.mjs',import.meta.url).href)};
try {await gatewayOperation({version:1,session:'session1',operationId:'op1',operation:'logs',services:['worker'],arguments:{limitBytes:4}},
{socketPath:${JSON.stringify(socketPath)},timeoutMs:1});process.exitCode=2;}
catch(e){if(e.message!=='gateway-client-refused')throw e;process.stdout.write('refused');}`],
        {env:{},cwd:root,stdio:['ignore','pipe','pipe',fd],timeout:3000});
    } finally {fs.closeSync(fd);}
    assert.equal(result.error,undefined,'FIFO read timed out before type validation');
    assert.equal(result.status,0,String(result.stderr));assert.equal(String(result.stdout),'refused');assert.equal(String(result.stderr),'');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('private client rejects path/timeout/argv overrides before host IO', async () => {
  const { gatewayOperation, validateClientCall } = await import('../m1a-gateway-client.mjs');
  const req = { version: 1, session: 'session1', operationId: 'op1', operation: 'logs', services: ['worker'], arguments: { limitBytes: 4 } };
  assert.deepEqual(validateClientCall(req, { socketPath: '/protected/gateway.sock', timeoutMs: 20000 }), req);
  for (const options of [{socketPath:'/x'}, {socketPath:'/x',timeoutMs:true},
    {socketPath:'/x',timeoutMs:0}, {socketPath:'/x',timeoutMs:1,python:'/evil'},
    {socketPath:'../x',timeoutMs:1}]) {
    assert.throws(() => validateClientCall(req, options), /gateway-client-refused/);
  }
  assert.throws(() => validateClientCall({...req, argv: ['evil']}, {socketPath:'/x',timeoutMs:1}), /gateway-client-refused/);
  await assert.rejects(gatewayOperation(req, {socketPath:'/x',timeoutMs:1}), /gateway-client-refused/);
});

test('Linux DEV private client runs fixed isolated Python and real Unix response', {skip:process.platform !== 'linux'}, async () => {
  const root=fs.mkdtempSync(path.join(os.homedir(),'.gateway-client-'));fs.chmodSync(root,0o700);
  const repo=fileURLToPath(new URL('../../../',import.meta.url));
  const socketPath=path.join(root,'gateway.sock');
  const python=spawnSync('python3',['-I','-S','-c','import sys,os;print(os.path.realpath(sys.executable))'],{encoding:'utf8'}).stdout.trim();
  assert(python.startsWith('/'));
  const loader=path.join(root,'loader.py');
  fs.writeFileSync(loader,`import sys\nsys.path.insert(0,${JSON.stringify(repo)})\nfrom scripts.m1_gateway.client import client_main\nsys.exit(client_main())\n`,{mode:0o600});
  fs.chmodSync(root,0o710);
  const ancestors=new Map();
  for (const item of [path.dirname(python),root,repo]) {
    let directory=item;
    while (true) { const st=fs.statSync(directory);ancestors.set(directory,{path:directory,uid:st.uid,gid:st.gid,mode:st.mode&0o7777,device:st.dev,inode:st.ino});
      if(directory==='/')break;directory=path.dirname(directory); }
  }
  const pin=filename=>{const st=fs.statSync(filename);return {path:filename,uid:st.uid,gid:st.gid,mode:st.mode&0o7777,device:st.dev,inode:st.ino,
    size:st.size,sha256:createHash('sha256').update(fs.readFileSync(filename)).digest('hex')};};
  const descriptor=path.join(root,'descriptor');fs.writeFileSync(descriptor,JSON.stringify({schema:'m1a-gateway-client-installation-v1',
    python:pin(python),moduleLoader:pin(loader),cwd:root,socketPath,serverUid:process.getuid(),socketGid:process.getgid(),
    ancestors:[...ancestors.values()],closure:[pin(loader)]}),{mode:0o600});
  const fixture=`import socket,struct,json,sys,os\ns=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.bind(sys.argv[1]);os.chmod(sys.argv[1],0o660);s.listen(1);print('ready',flush=True)\nc,_=s.accept()\ndef read(n):\n b=bytearray()\n while len(b)<n:\n  d=c.recv(n-len(b))\n  if not d: raise RuntimeError('disconnect')\n  b.extend(d)\n return bytes(b)\nr=json.loads(read(struct.unpack('!I',read(4))[0]));v={'version':1,'operationId':r['operationId'],'state':'observed-success','exitCode':0,'result':{'streams':{'available':True,'complete':True,'stdoutBase64':'cHJpdmF0ZQ==','stderrBase64':''}}}\nb=json.dumps(v,separators=(',',':')).encode();c.sendall(struct.pack('!I',len(b))+b);c.close();s.close()\n`;
  const server=spawn(python,['-I','-S','-c',fixture,socketPath],{env:{},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('fixture readiness expired')),5000);
      server.stdout.once('data',()=>{clearTimeout(timer);resolve();});
      server.once('error',error=>{clearTimeout(timer);reject(error);});
      server.once('exit',()=>{clearTimeout(timer);reject(new Error('fixture exited before readiness'));});
    });
    const fd=fs.openSync(descriptor,'r');
    let child;
    try {child=spawn(process.execPath,['--input-type=module','-e',`import {gatewayOperation} from ${JSON.stringify(new URL('../m1a-gateway-client.mjs',import.meta.url).href)};const r=await gatewayOperation({version:1,session:'session1',operationId:'op1',operation:'logs',services:['worker'],arguments:{limitBytes:100}},{socketPath:${JSON.stringify(socketPath)},timeoutMs:20000});process.stdout.write(JSON.stringify(r));`],
      {env:{},cwd:root,stdio:['ignore','pipe','pipe',fd]});}finally{fs.closeSync(fd);}
    let output='',errors='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>errors+=v);
    const status=await new Promise(resolve=>child.once('close',resolve));
    assert.equal(status,0,errors);assert.equal(errors,'');assert.equal(JSON.parse(output).result.streams.stdoutBase64,'cHJpdmF0ZQ==');
  } finally {server.kill();fs.rmSync(root,{recursive:true,force:true});}
});
test('private codec rejects unavailable fake streams and response mismatch', async () => {
  const { decodeClientResponse } = await import('../m1a-gateway-client.mjs');
  const good = {version:1, operationId:'op1', state:'observed-success', exitCode:0,
    result:{streams:{available:true,complete:true,stdoutBase64:'',stderrBase64:'AP8='}}};
  assert.deepEqual(decodeClientResponse(Buffer.from(JSON.stringify(good)), 'op1'), good);
  for (const value of [ {...good,operationId:'other'}, {...good,exitCode:true},
    {...good,result:{streams:{available:false,complete:false,stdoutBase64:'',stderrBase64:null}}},
    {...good,result:{streams:{available:true,complete:true,stdoutBase64:'AB==',stderrBase64:''}}}]) {
    assert.throws(() => decodeClientResponse(Buffer.from(JSON.stringify(value)), 'op1'), /gateway-client-refused/);
  }
});
