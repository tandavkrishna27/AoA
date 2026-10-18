// Bounded engineering composition: the shipped supervisor controls REAL native
// Node children and JSON bytes. Sandbox identity/staging use the existing test
// provider. This does not certify E2B, service_reconcile placement, DB projection,
// a control-plane generation rollout, the company budget gate, or a paid provider.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createSupervisor } from '../supervisor/supervisor.js';
import type { ProcessObservation, StagedFileRequest } from '../supervisor/provider.js';
import { createFakeSandboxProvider } from './support/fake-provider.js';
import { collectingSink, makeServiceHandoff, SERVICE_FIXTURE_IDS, SUPERVISOR_IDENTITY } from './support/supervisor-fixtures.js';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const checkpoint = '00000000-0000-4000-8000-0000000000c1';
const prefix = `/tmp/aoa-service-state/${SERVICE_FIXTURE_IDS.serviceId}/`;
const outputPath = '/home/user/aoa-output/state.json';

describe('W13 actual native process lifecycle engineering', () => {
  it('observes crash/restart, verifies stop/export/restore JSON identity, changes generation only after exit, and stops on the real run budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aoa-service-native-'));
    const children: ChildProcess[] = [];
    const childScript = join(root, 'service.mjs');
    await writeFile(childScript, `import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const [state,stop,mode] = process.argv.slice(2);
let counter=existsSync(state)?JSON.parse(readFileSync(state,'utf8')).counter:0;
writeFileSync(state,JSON.stringify({counter:++counter}));
const timer=setInterval(()=>{if(existsSync(stop)){clearInterval(timer);process.exit(0)}},10);
if(mode!=='budget')setTimeout(()=>{clearInterval(timer);process.exit(mode==='crash'?3:0)},120);
`);
    try {
      let saved = '', savedHash = '', previous: ChildProcess | undefined;
      async function leg(index: number, generation: number, mode: string, restore = false) {
        const dir = join(root, String(index)); await mkdir(dir);
        const state = join(dir, 'state.json'), stop = join(dir, 'stop');
        const marker = `${prefix}.aoa-checkpoint-${checkpoint}-${generation}.json`;
        const objects = { state: saved, marker: JSON.stringify({ generation }) };
        const files: StagedFileRequest[] = restore ? [
          { path: `${prefix}state.json`, grant: { objectKey: 'state', expectedSha256: savedHash, maxBytes: saved.length } as never },
          { path: marker, grant: { objectKey: 'marker', expectedSha256: hash(objects.marker), maxBytes: objects.marker.length } as never },
        ] : [];
        const provider = createFakeSandboxProvider({ processSupervisionMode: 'handle', fileStagingMode: 'grant_download', stagedObjects: objects });
        let child: ChildProcess | undefined;
        const observation = (): ProcessObservation => !child ? { state: 'unknown', reason: 'handle_unrecognized' }
          : child.exitCode !== null || child.signalCode !== null ? { state: 'exited', exitCode: child.exitCode, signal: child.signalCode, observedAt: Date.now() }
          : { state: 'running', observedAt: Date.now() };
        provider.startProcess = async input => {
          if (previous) expect(previous.exitCode !== null || previous.signalCode !== null).toBe(true);
          if (restore) {
            const staged = provider.stagedFiles()[`${prefix}state.json`];
            expect(hash(staged!)).toBe(savedHash);
            await writeFile(state, staged!);
          }
          child = spawn(input.command, [...input.args], { stdio: 'ignore', windowsHide: true }); children.push(child);
          await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
          return { providerOpId: 'native-start', handle: String(child.pid), acknowledgedAt: Date.now() };
        };
        provider.processStatus = async (_sandbox, handle) => {
          expect(handle).toBe(String(child?.pid)); return { providerOpId: 'native-status', observation: observation() };
        };
        provider.signalProcess = async (_sandbox, handle, kind) => {
          expect(handle).toBe(String(child?.pid));
          if (kind === 'cancel') await writeFile(stop, 'stop'); else child!.kill('SIGKILL');
          return { providerOpId: 'native-signal', accepted: 'accepted', observation: observation() };
        };
        const originalDestroy = provider.destroy.bind(provider);
        provider.destroy = async (...args) => {
          expect(observation().state).toBe('exited'); return originalDestroy(...args);
        };
        provider.digestArtifact = async (_sandbox, path) => {
          expect(path).toBe(outputPath); const bytes = await readFile(state);
          return { sha256: hash(bytes), sizeBytes: bytes.length };
        };
        const sink = collectingSink();
        const supervisor = createSupervisor({ provider, identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [],
          serviceHealthTickMs: 10, opDeadlineMs: mode === 'budget' ? 250 : 2000,
          resolveStagedFiles: async () => files,
          resolveExportArtifacts: async () => [{ path: outputPath, kind: 'stdout', contentType: 'text/plain', retention: 'standard' }],
          exportArtifacts: async ({ requests, exporter }) => {
            expect(observation().state).toBe('exited');
            expect(sink.events.map(e => e.eventType)).toContain('service_instance_stopped');
            expect(sink.events.map(e => e.eventType)).not.toContain('terminal');
            expect(requests).toEqual([{ path: outputPath, kind: 'service_checkpoint', contentType: 'application/json', retention: 'standard' }]);
            const digest = await exporter.digest(outputPath);
            const bytes = await readFile(state, 'utf8'); expect(digest.sha256).toBe(hash(bytes));
            await writeFile(join(dir, 'immutable-checkpoint.json'), bytes, { flag: 'wx' });
            saved = bytes; savedHash = hash(bytes);
            return { exported: [], failures: [] }; // no invented artifact commit receipt
          },
        });
        const base = makeServiceHandoff({ generation, command: process.execPath, args: [childScript, state, stop, mode], checkpointArtifactId: restore ? checkpoint : null, gracefulStopSeconds: 1 });
        const handoff = restore ? { ...base, offer: { ...base.offer, job: { ...base.offer.job, extensions: [{ namespace: 'com.armyofagents.job/staged-input', schemaVersion: 1, critical: false as const,
          value: { files: files.map(file => ({ id: checkpoint, path: file.path, key: file.grant.objectKey, sha256: file.grant.expectedSha256, size: file.grant.maxBytes })) } }] } } } : base;
        const start = Date.now(); await supervisor.accept(handoff);
        const types = sink.events.map(e => e.eventType);
        expect(types).toContain('service_health'); expect(types).toContain('service_instance_stopped');
        expect(types.indexOf('service_instance_stopped')).toBeLessThan(types.indexOf('terminal'));
        if (restore) expect(types.indexOf('service_checkpoint_restored')).toBeLessThan(types.indexOf('service_instance_started'));
        const identity = sink.events.find(e => e.eventType === 'service_instance_started')!.payload;
        expect(identity).toMatchObject({ serviceId: SERVICE_FIXTURE_IDS.serviceId, generation });
        expect(sink.events.find(e => e.eventType === 'terminal')!.payload).toMatchObject({ status: mode === 'crash' ? 'failed' : 'succeeded' });
        if (mode === 'budget') { expect(types).toContain('service_graceful_stop_observed'); expect(Date.now() - start).toBeGreaterThanOrEqual(240); }
        expect(provider.callCount('health')).toBe(0); expect(supervisor.activeRunCount()).toBe(0);
        expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true); previous = child;
        return { bytes: saved, sha256: savedHash };
      }
      const crashed = await leg(1, 3, 'crash'); expect(JSON.parse(crashed.bytes).counter).toBe(1);
      const restored = await leg(2, 3, 'normal', true); expect(JSON.parse(restored.bytes).counter).toBe(2);
      expect(hash(await readFile(join(root, '1', 'immutable-checkpoint.json')))).toBe(crashed.sha256);
      await leg(3, 4, 'normal'); // bounded new generation after the prior child exited
      await leg(4, 4, 'budget'); // actual elapsed time, no fake timers or clock acceleration
    } finally {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await new Promise(r => child.once('exit', r)); }
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
