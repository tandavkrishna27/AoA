// W11 measured regression: accepted worker terminals completed attempts while
// pinning their Organization slots, jobs and active leases until the 5m TTL.
// Exercise real event ingest under aoa_app and the shipped admission/reaper paths.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalEventDigestInputV1, type EventUploadOperationRequestV1, type LeaseOfferV1 } from '@armyofagents/worker-protocol';
import { createJobEventIngestService } from '../services/job-events.js';
import { createJobReconciliationService } from '../services/job-reconciliation.js';
import { admitAttemptCapacity } from '../services/org-concurrency.js';
import { submitJobWithinTenant } from '../services/job-submission.js';
import { runInTenant } from '../db/tenant-context.js';
import { ORG, COMPANY, WORKER, auth, setupJobControlFixture, type JobControlFixture } from './helpers/job-control-fixture.js';

const integration = describe.skipIf(process.platform === 'win32' && process.env.AOA_RUN_WIN_INTEGRATION !== '1');
integration('W11 accepted terminal convergence before natural lease expiry', () => {
  let fx: JobControlFixture;
  let priorFlag: string | undefined;
  beforeAll(async () => {
    priorFlag = process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
    process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = 'true';
    fx = await setupJobControlFixture('terminal-convergence');
  }, 180_000);
  beforeEach(async () => { await fx.resetRuntimeRows(); await fx.admin`UPDATE organizations SET concurrency_cap = 1 WHERE id = ${ORG}`; });
  afterAll(async () => {
    if (priorFlag === undefined) delete process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
    else process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = priorFlag;
    await fx?.teardown();
  }, 60_000);
  function event(offer: LeaseOfferV1, seq: number, status?: string) {
    const value = { protocolVersion: 1, eventId: randomUUID(), organizationId: ORG, companyId: COMPANY, workerId: WORKER,
      jobId: offer.job.jobId, attempt: offer.job.attempt, leaseId: offer.leaseId, fenceToken: offer.fenceToken,
      seq, occurredAt: new Date().toISOString(), extensions: [], eventType: status ? 'terminal' : 'attempt_started',
      payload: status ? { status, exitCode: status === 'succeeded' ? 0 : 1, errorCode: null, errorMessage: null } : { sandboxId: 'terminal-convergence-native-owner' } };
    return { ...value, eventDigest: createHash('sha256').update(canonicalEventDigestInputV1(value)).digest('hex') };
  }
  function request(offer: LeaseOfferV1, events: ReturnType<typeof event>[]): EventUploadOperationRequestV1 {
    return { protocolVersion: 1, correlationId: randomUUID(), issuedAt: new Date().toISOString(), nonce: randomUUID(), audience: 'worker_run', idempotencyKey: randomUUID(),
      body: { protocolVersion: 1, organizationId: ORG, companyId: COMPANY, workerId: WORKER, jobId: offer.job.jobId,
        attempt: offer.job.attempt, leaseId: offer.leaseId, fenceToken: offer.fenceToken, events } } as unknown as EventUploadOperationRequestV1;
  }
  const ingest = (offer: LeaseOfferV1, events: ReturnType<typeof event>[]) => createJobEventIngestService({ appDb: fx.app.db }).ingest({ auth: auth(randomUUID()), request: request(offer, events) });
  async function active(ordinal: number, maxAttempts = 3) {
    const value = await fx.activateLease(ordinal, { maxAttempts });
    const claim = await runInTenant(fx.app.db, ORG, (_repos, tx) => admitAttemptCapacity(tx, {
      organizationId: ORG, companyId: COMPANY, attemptId: value.seeded.attemptId, workloadType: 'batch', principalId: 'terminal-test', principalKind: 'system' }));
    expect(claim.admitted).toBe(true);
    expect((await ingest(value.offer, [event(value.offer, 1)])).ack.status).toBe('accepted');
    return value;
  }
  async function state(jobId: string) {
    const [row] = await fx.admin`SELECT j.status AS job_status,a.status AS attempt_status,a.capacity_claim_state,
      a.capacity_released_at,l.status AS lease_status,l.released_at,(l.expires_at > clock_timestamp()) AS expires_fresh,
      (SELECT count(*)::int FROM job_events e WHERE e.job_id=j.id) AS event_count,
      (SELECT count(*)::int FROM job_attempts h WHERE h.organization_id=j.organization_id AND h.capacity_claim_state='held') AS held
      FROM jobs j JOIN job_attempts a ON a.job_id=j.id AND a.attempt_number=1 JOIN leases l ON l.attempt_id=a.id WHERE j.id=${jobId}`;
    return row;
  }
  const submitFresh = () => runInTenant(fx.app.db, ORG, (repos, tx) => submitJobWithinTenant(repos, {
    organizationId: ORG, companyId: COMPANY, principal: { kind: 'system', id: 'terminal-convergence' },
    command: { idempotencyKey: randomUUID(), source: { kind: 'one_shot', operationId: randomUUID(), operationKind: 'readiness_probe' }, input: { probe: 'fresh' } },
  }, tx));

  for (const status of ['succeeded', 'cancelled']) it(status + ' immediately ends job/lease, frees capacity and admits fresh work without a reaper', async () => {
    const { seeded, offer } = await active(status === 'succeeded' ? 8101 : 8102);
    await expect(submitFresh()).rejects.toMatchObject({ status: 429 });
    expect((await ingest(offer, [event(offer, 2, status)])).ack.status).toBe('accepted');
    const ended = await state(seeded.jobId);
    expect(ended).toMatchObject({ job_status: status, attempt_status: status, capacity_claim_state: 'released', held: 0,
      lease_status: status === 'succeeded' ? 'released' : 'revoked', expires_fresh: true, event_count: 2 });
    expect(ended.capacity_released_at).not.toBeNull(); expect(ended.released_at).not.toBeNull();
    const fresh = await submitFresh(); expect(fresh.replayed).toBe(false);
    // Duplicate/late terminal traffic cannot release the new job's distinct slot,
    // alter immutable terminal identity, or restamp the original release time.
    expect((await ingest(offer, [event(offer, 3, 'failed')])).ack.status).toBe('terminal');
    expect(await state(seeded.jobId)).toEqual({ ...ended, held: 1 });
    const reaped = await createJobReconciliationService({ appDb: fx.app.db }).reapOrganization(ORG);
    expect(reaped.scanned).toBe(0);
  }, 60_000);

  it('terminal replay preserves stable ACK and performs no second resource release', async () => {
    const { seeded, offer } = await active(8103); const terminal = event(offer, 2, 'succeeded');
    const service = createJobEventIngestService({ appDb: fx.app.db }); const operation = request(offer, [terminal]);
    const first = await service.ingest({ auth: auth('terminal-original'), request: operation });
    const ended = await state(seeded.jobId);
    const replay = await service.ingest({ auth: auth('terminal-replayed'), request: operation });
    expect(first.ack.status).toBe('accepted'); expect(replay.ack.status).toBe('terminal');
    expect(replay.ack.acceptedThroughSeq).toBe(first.ack.acceptedThroughSeq); expect(await state(seeded.jobId)).toEqual(ended);
  }, 60_000);

  it('multiple terminals in one accepted batch preserve the first terminal winner', async () => {
    const { seeded, offer } = await active(8111);
    expect((await ingest(offer, [event(offer, 2, 'succeeded'), event(offer, 3, 'failed')])).ack.status).toBe('accepted');
    expect(await state(seeded.jobId)).toMatchObject({ job_status: 'succeeded', attempt_status: 'succeeded', capacity_claim_state: 'released', held: 0, lease_status: 'released', event_count: 3 });
  }, 60_000);

  it('a stale terminal fence cannot finalize or release a held capacity claim', async () => {
    const { seeded, offer } = await active(8104);
    await fx.admin`UPDATE leases SET ack_deadline=clock_timestamp()-interval '2 seconds', expires_at=clock_timestamp()-interval '1 second' WHERE id=${offer.leaseId}`;
    expect((await ingest(offer, [event(offer, 2, 'succeeded')])).ack.status).toBe('stale_fence');
    expect(await state(seeded.jobId)).toMatchObject({ job_status: 'running', attempt_status: 'running', capacity_claim_state: 'held', held: 1, lease_status: 'active', event_count: 1 });
  }, 60_000);

  it('a foreign tenant cannot complete or release the actual tenant fence', async () => {
    const { seeded, offer } = await active(8105);
    await expect(createJobEventIngestService({ appDb: fx.app.db }).ingest({ auth: { ...auth('foreign-terminal'), organizationId: randomUUID() },
      request: request(offer, [event(offer, 2, 'succeeded')]) })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(await state(seeded.jobId)).toMatchObject({ job_status: 'running', attempt_status: 'running', capacity_claim_state: 'held', held: 1, lease_status: 'active', event_count: 1 });
  }, 60_000);

  for (const [status, maxAttempts] of [['failed', 1], ['failed', 3], ['expired', 1], ['expired', 3]] as const) it(status + ' attempt preserves reaper retry/exhaustion policy, maxAttempts=' + maxAttempts, async () => {
    const { seeded, offer } = await active(8106 + maxAttempts + (status === 'expired' ? 10 : 0), maxAttempts);
    expect((await ingest(offer, [event(offer, 2, status)])).ack.status).toBe('accepted');
    expect(await state(seeded.jobId)).toMatchObject({ job_status: 'running', attempt_status: status, capacity_claim_state: 'held', held: 1, lease_status: 'active', event_count: 2 });
    await expect(submitFresh()).rejects.toMatchObject({ status: 429 });
    await fx.admin`UPDATE leases SET ack_deadline=clock_timestamp()-interval '2 seconds', expires_at=clock_timestamp()-interval '1 second' WHERE id=${offer.leaseId}`;
    const reaped = await createJobReconciliationService({ appDb: fx.app.db, baseBackoffMs: 0 }).reapOrganization(ORG);
    expect(reaped.retried).toBe(maxAttempts > 1 ? 1 : 0); expect(reaped.deadLettered).toBe(maxAttempts === 1 ? 1 : 0);
    const [job] = await fx.admin`SELECT status FROM jobs WHERE id=${seeded.jobId}`;
    expect(job.status).toBe(maxAttempts > 1 ? 'queued' : 'dead_letter');
    const rows = await fx.admin`SELECT attempt_number,status,capacity_claim_state FROM job_attempts WHERE job_id=${seeded.jobId} ORDER BY attempt_number`;
    expect(rows[0].status).toBe(status); expect(rows.length).toBe(maxAttempts > 1 ? 2 : 1);
    expect(rows[0].capacity_claim_state).toBe('released');
    if (maxAttempts > 1) {
      expect(rows[1]).toMatchObject({ status: 'pending', capacity_claim_state: 'held' });
      await expect(submitFresh()).rejects.toMatchObject({ status: 429 });
    } else expect((await submitFresh()).replayed).toBe(false);
  }, 60_000);

  it('the guarded completeAttempt seam shares immediate success convergence', async () => {
    const { seeded, identity } = await active(8110);
    await runInTenant(fx.app.db, ORG, repos => repos.jobControl.completeAttempt({ ...identity, terminalStatus: 'succeeded' }));
    expect(await state(seeded.jobId)).toMatchObject({ job_status: 'succeeded', attempt_status: 'succeeded', capacity_claim_state: 'released', held: 0, lease_status: 'released', expires_fresh: true });
  }, 60_000);
});
