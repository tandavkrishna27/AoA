import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
test('actual CLI restores automatic COPY backups as SQL and gzip without PostgreSQL tools', { timeout: 120000 }, async () => {
const cwd=process.cwd();
const dir=mkdtempSync(path.join(tmpdir(),'aoa-m4-cli-restore-'));
const password=randomBytes(24).toString('hex');
let id;
function run(cmd,args,options={}) {
 const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,...options});
 if(r.status!==0) throw new Error(`${cmd} failed: ${String(r.stderr||r.stdout||r.error).replaceAll(password,'[redacted]').slice(-1500)}`);
 return r.stdout.trim();
}
try {
 id=run('docker',['run','-d','--rm','-e',`POSTGRES_PASSWORD=${password}`,'-p','127.0.0.1::5432','postgres@sha256:0027bef26712baaee437a4ea48fdf3d2d2e2bc5f0d81615374408ca320f3c7e3']);
 if(!/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid container ID');
 // The image's temporary init server accepts Unix sockets before restarting.
 // Only the final server listens on TCP; socket readiness races that restart.
 for(let n=0;n<50;n++) { const r=spawnSync('docker',['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres'],{encoding:'utf8'}); if(r.status===0)break; if(n===49)throw new Error('database not ready'); await new Promise(r=>setTimeout(r,200)); }
 const mapping=run('docker',['port',id,'5432/tcp']);
 const port=Number(mapping.split(':').at(-1));
 if(!Number.isInteger(port))throw new Error('invalid port');
 const env={...process.env,AOA_PG_DUMP_PATH:path.join(dir,'missing-pg-dump'),AOA_PSQL_PATH:path.join(dir,'missing-psql'),DATABASE_URL:`postgres://postgres:${password}@127.0.0.1:${port}/postgres`};
 const sql=s=>run('docker',['exec','-i',id,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:s});
 sql("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text,created_at bigint); INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES('m4-fixture',1234567890); CREATE TABLE public.restore_fixture(company_id uuid PRIMARY KEY,payload text); INSERT INTO public.restore_fixture VALUES('11111111-1111-4111-8111-111111111111','company-a'),('22222222-2222-4222-8222-222222222222','company-b');");
 const cli=(args,ok=true)=>{const r=spawnSync(process.execPath,['cli/node_modules/tsx/dist/cli.mjs','cli/src/index.ts',...args],{cwd,env,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}); if(r.status===null || r.error)throw new Error(`CLI ${args[0]} failed to terminate: ${r.error?.code || r.signal}`); if((r.status===0)!==ok)throw new Error(`CLI ${args[0]} unexpected status ${r.status}: ${String(r.stderr||r.stdout).replaceAll(password,'[redacted]').slice(-1500)}`);return r;};
 cli(['db:backup','--dir',dir,'--filename-prefix','m4-cli','--json']);
 const backup=readdirSync(dir).find(n=>n.endsWith('.sql.gz'));
 if(!backup)throw new Error('SQL backup missing');
 const compressed=path.join(dir,backup); const file=compressed.slice(0,-3);writeFileSync(file,gunzipSync(readFileSync(compressed)));
 const verify=()=>{if(sql('SELECT string_agg(payload,\',\' ORDER BY payload) FROM public.restore_fixture;')!=='company-a,company-b')throw new Error('tenant fixture mismatch');if(sql('SELECT hash FROM drizzle.__drizzle_migrations;')!=='m4-fixture')throw new Error('migration journal mismatch');};
 sql('DELETE FROM public.restore_fixture; DELETE FROM drizzle.__drizzle_migrations;');
 cli(['db:restore','--file',file]);verify();
 const gz=file+'.gz';writeFileSync(gz,gzipSync(readFileSync(file)));
 sql('DELETE FROM public.restore_fixture; DELETE FROM drizzle.__drizzle_migrations;');
 cli(['db:restore','--file',gz]);verify();
 cli(['db:restore','--file',path.join(dir,'absent.sql')],false);
 const corrupt=path.join(dir,'corrupt.sql.gz');writeFileSync(corrupt,'not gzip');
 cli(['db:restore','--file',corrupt],false);verify();
 const truncated=path.join(dir,'truncated.sql');
 const text=readFileSync(file,'utf8');
 const firstTerminator=text.indexOf('\\.\n');
 if(firstTerminator<0)throw new Error('automatic fallback did not produce COPY data');
 writeFileSync(truncated,text.slice(0,firstTerminator));
 cli(['db:restore','--file',truncated],false);verify();
 const invalid=path.join(dir,'invalid-copy.sql');
 writeFileSync(invalid,text.replace('11111111-1111-4111-8111-111111111111\t','invalid-uuid\t'));
 cli(['db:restore','--file',invalid],false);verify();
 // Exercise the real PostgreSQL catalogs, including grants that leave relacl null.
 sql("CREATE ROLE m4_backup_reader NOLOGIN; CREATE TYPE public.m4_backup_enum AS ENUM ('ready'); CREATE TABLE public.security_fixture(payload text);");
 const securityCases = [
   ['column grant', 'GRANT SELECT (payload) ON public.security_fixture TO m4_backup_reader;', 'DROP TABLE public.security_fixture;'],
   ['schema grant', 'GRANT CREATE ON SCHEMA public TO m4_backup_reader;', 'REVOKE CREATE ON SCHEMA public FROM m4_backup_reader;'],
   ['type grant', 'GRANT USAGE ON TYPE public.m4_backup_enum TO m4_backup_reader;', 'REVOKE USAGE ON TYPE public.m4_backup_enum FROM m4_backup_reader;'],
 ];
 for (const [name, grant, revoke] of securityCases) {
   cli(['db:backup','--dir',dir,'--filename-prefix','before-' + name.split(' ')[0]]);
   sql(grant);
   const prefix = 'rejected-' + name.split(' ')[0];
   const rejected = cli(['db:backup','--dir',dir,'--filename-prefix',prefix],false);
   if (!/native PostgreSQL backup.*security objects/i.test(rejected.stderr + rejected.stdout)) throw new Error(`${name} did not reach the security fallback guard`);
   if (readdirSync(dir).some(n => n.startsWith(prefix))) throw new Error(`${name} left a misleading backup file`);
   sql(revoke);
 }
 const result={result:'PASS',cases:['CLI SQL restore','CLI gzip restore','migration journal preserved','two company fixture payloads preserved','missing file nonzero','corrupt gzip nonzero, data preserved','truncated COPY nonzero, transaction rolled back','invalid UUID COPY nonzero without timeout, transaction rolled back','column ACL refuses incomplete fallback','schema ACL refuses incomplete fallback','type ACL refuses incomplete fallback'],backupDirectory:dir,limits:'Synthetic fixture, not full application schema, stale fence recovery or production RPO/RTO'};
 writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally { if(id&&/^[a-f0-9]{64}$/.test(id))run('docker',['stop','-t','3',id]); }

});
