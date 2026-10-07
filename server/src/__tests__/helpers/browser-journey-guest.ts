import { spawn, execFile } from 'node:child_process';
import { createServer, request as httpsRequest } from 'node:https';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagedPathFromMarker } from '../../services/job-input-staging.js';
import type { StorageProvider } from '../../storage/types.js';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import type { executePinnedRequest } from '../../services/outbound-url-guard.js';

export function accumulateDescendantPids(table:ReadonlyArray<{pid:number;parent:number;createdAt?:number}>,owned:Set<number>,startedAt=0):void {
  let added=true;while(added){added=false;for(const row of table)if((row.createdAt===undefined||row.createdAt>=startedAt)&&owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);added=true;}}
}

async function processTable():Promise<Array<{pid:number;parent:number;name:string;createdAt?:number;identity?:string}>> {
  if(process.platform==='win32') {
    const {stdout}=await promisify(execFile)('powershell',['-NoProfile','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{Name="CreatedAt";Expression={[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress'],{timeout:10000});
    return JSON.parse(stdout).map((row:{ProcessId:number;ParentProcessId:number;Name:string;CreatedAt:number})=>({pid:row.ProcessId,parent:row.ParentProcessId,name:row.Name,createdAt:row.CreatedAt,identity:String(row.CreatedAt)}));
  }
  const {stdout}=await promisify(execFile)('ps',['-eo','pid=,ppid=,comm='],{timeout:10000});
  return (await Promise.all(stdout.trim().split('\n').map(async line=>{const [pid,parent,name]=line.trim().split(/\s+/);try {const stat=await readFile('/proc/'+pid+'/stat','utf8');const identity=stat.slice(stat.lastIndexOf(')')+2).split(/\s+/)[19];return {pid:Number(pid),parent:Number(parent),name,identity};}catch{return null;}}))).filter((row):row is {pid:number;parent:number;name:string;identity:string}=>row!==null);
}

/** Local provider harness only: a filesystem mount translation, public DNS/dial
 * seam and fixture certificate trust. Production policy/config bytes are never
 * altered. Windows' synthetic /proc establishes no production containment. */
export async function runStagedBrowserJourney(input:{
  root:string; companyId:string; storage:StorageProvider;
  artifacts:Array<{content_type:string;object_key:string}>;
  cookieValue:string;
  onIssuer(dispatch:typeof executePinnedRequest):void;
  onIntent(message:Record<string,unknown>,deliver:(directory:string,requestId:string,body:unknown)=>Promise<void>):Promise<void>;
}) {
  const mount=join(input.root,'guest'); await mkdir(mount,{recursive:true});
  await mkdir(join(mount,'aoa-output'),{recursive:true});
  const mounted=(path:string)=>join(mount,path.replace(/^\/home\/user\//,''));
  let runner='',config='';
  for(const artifact of input.artifacts) {
    const path=stagedPathFromMarker(artifact.content_type); if(!path)throw new Error('invalid staged path');
    const object=await input.storage.getObject({companyId:input.companyId,objectKey:artifact.object_key});
    const chunks:Buffer[]=[];for await(const chunk of object.stream)chunks.push(Buffer.from(chunk));
    const destination=mounted(path); await mkdir(dirname(destination),{recursive:true});await writeFile(destination,Buffer.concat(chunks));
    if(path.endsWith('/runner.js'))runner=destination;if(path.endsWith('/session.json'))config=destination;
  }
  if(!runner||!config)throw new Error('missing staged entrypoint');
  assert.equal(JSON.parse(await readFile(config,'utf8')).videoDir,'/home/user/.aoa/browser-video-staging');
  let authenticatedNavigations=0,issuerExchanges=0;
  const server=createServer({cert:await readFile(new URL('../../../../docker/d1/certs/public.crt',import.meta.url)),key:await readFile(new URL('../../../../docker/d1/certs/private.key',import.meta.url))},(req,res)=>{
    if(req.url==='/login'&&req.method==='POST'&&req.headers.authorization==='Bearer keyless_cp_access_token') {
      issuerExchanges++;res.writeHead(200,{'set-cookie':`__Host-session=${input.cookieValue}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=120`});res.end('{}');return;
    }
    if(req.url!=='/dashboard'||req.headers.cookie!==`__Host-session=${input.cookieValue}`){res.writeHead(401);res.end('denied');return;}
    authenticatedNavigations++;
    // Hold the authenticated response until its late renderer is included in
    // the census while Chromium still owns it; do not rely on the first prompt.
    void recordChildren().then(()=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><title>Authenticated journey</title><body>Scoped session established</body>');},error=>res.destroy(error));
  });
  const sockets=new Set<import('node:net').Socket>();server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('TLS fixture bind failed');
  input.onIssuer(async(target,init,signal,options)=>{
    assert.equal(target.parsedUrl.origin,'https://mcp.notion.com');assert.equal(target.resolvedAddress,'93.184.216.34');assert.equal(Number(target.parsedUrl.port||443),443);assert.equal(target.hostHeader,'mcp.notion.com');assert.equal(target.tlsServername,'mcp.notion.com');assert.equal(target.useTls,true);assert.equal(options?.maxBodyBytes,8192);
    return new Promise((resolve,reject)=>{
      const request=httpsRequest({host:'127.0.0.1',port:address.port,path:'/login',method:init.method,headers:{...Object.fromEntries(new Headers(init.headers).entries()),Host:target.hostHeader},servername:target.tlsServername,rejectUnauthorized:false,signal},res=>{
        const chunks:Buffer[]=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>8192){request.destroy(new Error('fixture issuer body exceeds ceiling'));return;}chunks.push(Buffer.from(chunk));});
        res.on('end',()=>resolve({status:res.statusCode!,statusText:res.statusMessage??'',headers:Object.fromEntries(Object.entries(res.headers).map(([key,value])=>[key,Array.isArray(value)?value.join(','):value??''])),body:Buffer.concat(chunks).toString()}));
      });request.once('error',reject);assert.equal(typeof init.body,'string');request.end(init.body as string);
    });
  });
  const preload=join(input.root,'provider-fixture.cjs');
  const playwright=createRequire(import.meta.url).resolve('playwright');
  await writeFile(preload,`
    const assert=require('node:assert/strict');
    const mount=${JSON.stringify(mount)};
    const map=p=>typeof p==='string'?p.replace(/^(?:[A-Za-z]:)?[\\/\\\\]+home[\\/\\\\]user(?=[\\/\\\\]|$)/,mount):p;
    for(const module of ['node:fs','node:fs/promises']) {
      const fs=require(module);
      for(const name of ['mkdir','mkdirSync','lstat','stat','open','unlink','readFile','writeFile','rename','copyFile','access','realpath','realpathSync','readFileSync','existsSync','createWriteStream']) {
        if(typeof fs[name]!=='function')continue;
        const original=fs[name].bind(fs);fs[name]=(path,...rest)=>{if(name==='rename'||name==='copyFile')rest[0]=map(rest[0]);return original(map(path),...rest);};
      }
    }
    if(process.platform==='win32') {
      const fs=require('node:fs/promises'),read=fs.readFile;
      fs.readFile=(p,...args)=>p==='/proc/net/tcp'||p==='/proc/net/tcp6'?Promise.resolve('sl local_address rem_address st\\n'):read(p,...args);
    }
    require('node:dns/promises').lookup=(host,options)=>{assert.equal(host,'mcp.notion.com');assert.equal(options.all,true);return Promise.resolve([{address:'93.184.216.34',family:4}]);};
    const net=require('node:net'),connect=net.connect;
    net.connect=(options,...rest)=>{assert.equal(options.host,'93.184.216.34');assert.equal(options.port,443);return connect({...options,host:'127.0.0.1',port:${address.port}},...rest);};
    const {chromium}=require(${JSON.stringify(playwright)}),launch=chromium.launchPersistentContext.bind(chromium);
    chromium.launchPersistentContext=(profile,options)=>launch(map(profile),{...options,downloadsPath:map(options.downloadsPath),...(options.recordVideo?{recordVideo:{...options.recordVideo,dir:map(options.recordVideo.dir)}}:{}),args:[...(options.args||[]),'--ignore-certificate-errors']});
  `);
  const startedAt=Date.now();
  const child=spawn(process.execPath,['--require',preload,runner,config],{stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_PATH:fileURLToPath(new URL('../../../../packages/browser-runtime/node_modules',import.meta.url))}});
  const events:Array<Record<string,unknown>>=[];let output='',buffer='';let processing=Promise.resolve();let error:unknown;
  const browserPids=new Set<number>();
  const ownedPids=new Set([child.pid!]);
  const ownedIdentities=new Map<number,string|undefined>();
  let scan:Promise<void>|undefined,censusTimer:NodeJS.Timeout|undefined,censusStopped=false;
  function recordChildren():Promise<void> {
    if(scan)return scan;
    scan=(async()=>{const table=await processTable();accumulateDescendantPids(table,ownedPids,startedAt);for(const row of table)if(ownedPids.has(row.pid)&&!ownedIdentities.has(row.pid))ownedIdentities.set(row.pid,row.identity);for(const row of table)if(ownedPids.has(row.pid)&&/chrome|chromium|ffmpeg/i.test(row.name))browserPids.add(row.pid);})().finally(()=>{scan=undefined;});
    return scan;
  }
  function continueCensus() {
    censusTimer=setTimeout(()=>{void recordChildren().then(()=>{if(!censusStopped)continueCensus();},cause=>{error=cause;child.kill();});},200);
  }
  continueCensus();
  const deliver=async(directory:string,id:string,body:unknown)=>{const target=mounted(directory);await mkdir(target,{recursive:true,mode:0o700});await writeFile(join(target,`${id}.json`),JSON.stringify(body),{mode:0o600,flag:'wx'});};
  child.stderr.on('data',chunk=>{output+=String(chunk);});
  child.stdout.on('data',chunk=>{output+=String(chunk);buffer+=String(chunk);let newline:number;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let event:Record<string,unknown>;try{event=JSON.parse(line);}catch{continue;}events.push(event);if(event.type==='approval_requested'||event.type==='session_credentials_requested')processing=processing.then(async()=>{await recordChildren();if(!browserPids.size)throw new Error('guest intent without a live browser process tree');await input.onIntent(event,deliver);}).catch(cause=>{error=cause;child.kill();});}});
  let timer:NodeJS.Timeout|undefined;
  try {
    const code=await Promise.race([new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error(`guest journey timeout: ${output}`));},30000);})]);
    await processing;if(error)throw error;if(code!==0)throw new Error(`guest failed (${code}): ${output}`);
    if(authenticatedNavigations!==1)throw new Error(`authenticated navigation count ${authenticatedNavigations}: ${output}`);
    if(issuerExchanges!==1)throw new Error(`issuer exchange count ${issuerExchanges}`);
    if(!events.some(event=>event.type==='session_started')||!events.some(event=>event.type==='session_completed'))throw new Error(`guest lifecycle missing: ${output}`);
    if(output.includes(input.cookieValue)||output.includes('keyless_cp_access_token'))throw new Error('guest leaked credential');
    censusStopped=true;if(censusTimer)clearTimeout(censusTimer);await recordChildren();
    const survivors=(await processTable()).filter(row=>ownedPids.has(row.pid)&&ownedIdentities.has(row.pid)&&ownedIdentities.get(row.pid)===row.identity);
    if(survivors.length)throw new Error(`orphaned guest browser PIDs: ${survivors.map(row=>row.pid).join(',')}`);
    return {events,authenticatedNavigations,mount,output};
  } finally {
    if(timer)clearTimeout(timer);if(child.exitCode===null)child.kill();
    censusStopped=true;if(censusTimer)clearTimeout(censusTimer);await scan;
    // Failed local Windows runs need explicit fixture-provider teardown; killing
    // Node alone does not establish Windows grandchild containment.
    if(process.platform==='win32') {
      const marker=join(mount,'.aoa','browser-profile').replaceAll("'","''");
      await promisify(execFile)('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|chromium' -and $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{timeout:10000});
    }
    for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(preload,{force:true});
  }
}
