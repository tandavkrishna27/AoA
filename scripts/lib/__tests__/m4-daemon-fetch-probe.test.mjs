import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

const probe=new URL('../m4-daemon-fetch-probe.mjs',import.meta.url);
test('probe persists starts before process death and preserves complete response bytes without secrets',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'m4-probe-'));
  const server=createServer((req,res)=>{if(req.url.endsWith('/poll'))return;res.writeHead(200,{'content-type':'application/json'});res.end('{"secret":"body-canary"}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  const log=path.join(dir,'requests.ndjson');
  try {
    const code=`const r=await fetch('${url}/api/worker-control/events',{headers:{authorization:'Bearer header-canary'}});if(await r.text()!=='{"secret":"body-canary"}')process.exit(2);fetch('${url}/api/worker-control/poll').catch(()=>{});setTimeout(()=>process.exit(0),50);`;
    const child=spawn(process.execPath,['--import',probe.href,'--input-type=module','-e',code],{env:{...process.env,AOA_M4_PROBE_LOG:log,AOA_M4_PROBE_TENANT:'quiet',AOA_M4_PROBE_DEADLINE_MS:'100'},stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
    const status=await new Promise(r=>child.on('exit',r));
    assert.equal(status,0,stderr);
    const text=readFileSync(log,'utf8');
    const records=text.trim().split('\n').map(JSON.parse);
    assert.equal(records.filter(r=>r.type==='start').length,2);
    assert.equal(records.filter(r=>r.type==='finish').length,1);
    assert.equal(records.find(r=>r.type==='finish').status,200);
    for(const secret of [url,'header-canary','body-canary','authorization'])assert.equal(text.includes(secret),false);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
