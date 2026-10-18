import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEventOutboxDrain, type EventOutboxDrain } from "../events/event-outbox-drain.js";
import { DurableWorkerEventSink } from "../events/durable-event-sink.js";
import {
  deriveStreamKey,
  openEventOutboxStore,
  type SqliteEventOutboxStore,
} from "../events/event-outbox-store.js";
import { staticSessionProvider } from "./support/renewal-fixtures.js";
import { enrollFixtureWorker } from "./support/poll-fixtures.js";
import { startFakeControlPlane, type FakeControlPlane } from "./support/fake-control-plane.js";
import { enrollmentCodeConfig } from "./support/poll-fixtures.js";
import { eventIdentity, samplePayloadFor, stampEvent } from "./support/event-fixtures.js";

const KEK = Buffer.alloc(32, 11);
const CODE = "evt-code";
const IDENTITY = eventIdentity();
const STREAM_KEY = deriveStreamKey(IDENTITY);

let dir: string;
let fake: FakeControlPlane;
let store: SqliteEventOutboxStore;
let sink: DurableWorkerEventSink;
let clock: { ms: number };
let drain: EventOutboxDrain;
let session: Awaited<ReturnType<typeof enrollFixtureWorker>>["session"];
let key: Awaited<ReturnType<typeof enrollFixtureWorker>>["key"];
let client: Awaited<ReturnType<typeof enrollFixtureWorker>>["client"];

async function buildDrain(sessionProvider = staticSessionProvider(session), maxRecoveries?: number): Promise<EventOutboxDrain> {
  return createEventOutboxDrain({
    store,
    client,
    session: sessionProvider,
    key,
    kek: KEK,
    now: () => clock.ms,
    rng: () => 0, // pin backoff jitter
    maxConsecutiveRecoveries: maxRecoveries,
    tuning: { backoff: { baseMs: 1_000, maxMs: 30_000, jitter: 0 } },
  });
}

function emit(seq: number, eventType: "log" | "terminal" = "log"): void {
  sink.emit(stampEvent(IDENTITY, seq, eventType, samplePayloadFor(eventType)));
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "aoa-drain-"));
  clock = { ms: 1_000 };
  fake = await startFakeControlPlane({ enrollments: [enrollmentCodeConfig(CODE)], now: () => clock.ms });
  const enrolled = await enrollFixtureWorker(fake, CODE);
  session = enrolled.session;
  key = enrolled.key;
  client = enrolled.client;
  store = await openEventOutboxStore({ path: join(dir, "events.db"), now: () => clock.ms });
  sink = new DurableWorkerEventSink({ store, kek: KEK, now: () => clock.ms });
  drain = await buildDrain();
});
afterEach(async () => {
  drain.stop();
  vi.useRealTimers();
  store.close();
  await fake.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("event-outbox scheduler — durable append latency", () => {
  function scheduledDrain(notify: boolean) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(1_000);
    const uploads: { atMs: number; seqs: number[]; key: string }[] = [];
    const behavior = { gate: null as Promise<void> | null, failures: 0, unauthorized: false, active: 0, maxActive: 0 };
    const transport = {
      ...client,
      eventUploadPath: client.eventUploadPath,
      eventUpload: async ({ bytes }: { bytes: Buffer }) => {
        const request = JSON.parse(bytes.toString("utf8"));
        const events = request.body.events;
        uploads.push({ atMs: Date.now(), seqs: events.map((event: { seq: number }) => event.seq), key: request.idempotencyKey });
        behavior.active += 1;
        behavior.maxActive = Math.max(behavior.active, behavior.maxActive);
        try {
        await behavior.gate;
        if (behavior.unauthorized || behavior.failures-- > 0) return { status: behavior.unauthorized ? 401 : 503,
          body: { protocolVersion: 1, correlationId: request.correlationId, serverTime: new Date().toISOString(),
            code: behavior.unauthorized ? "unauthorized" : "internal_unavailable", message: "unavailable",
            retryAfterMs: 5000, redaction: "secret", detail: {} } };
        const acceptedThroughSeq = events.at(-1).seq;
        return { status: 200, body: { protocolVersion: 1, correlationId: request.correlationId,
          serverTime: new Date().toISOString(), ack: { protocolVersion: 1, ...IDENTITY, jobId: request.body.jobId,
            acceptedThroughSeq, expectedNextSeq: acceptedThroughSeq + 1, status: "accepted" } } };
        } finally { behavior.active -= 1; }
      },
    };
    drain = createEventOutboxDrain({ store, client: transport as never, session: staticSessionProvider(session), key, kek: KEK });
    sink = new DurableWorkerEventSink({ store, kek: KEK,
      ...(notify ? { onPersisted: () => drain.wake() } : {}) });
    return { uploads, behavior };
  }

  it("periodic-only control leaves a real SQLite terminal idle for 1900ms after append", async () => {
    const { uploads } = scheduledDrain(false);
    drain.start();
    await vi.advanceTimersByTimeAsync(1_500); // first pass finds no rows
    await vi.advanceTimersByTimeAsync(100);
    emit(1, "terminal");
    expect(store.getRow(STREAM_KEY, 1)?.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_899);
    expect(uploads).toEqual([]);
    expect(store.countPending()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(uploads).toMatchObject([{ atMs: 4_500, seqs: [1] }]);
    expect(store.countPending()).toBe(0);
  });

  it("a post-commit wake uploads the same terminal without waiting for the idle interval", async () => {
    const { uploads } = scheduledDrain(true);
    drain.start();
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(100);
    emit(1, "terminal");
    // Callback only schedules: emit has returned with the real row committed,
    // without doing any network work inline.
    expect(store.getRow(STREAM_KEY, 1)?.status).toBe("pending");
    expect(uploads).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads).toMatchObject([{ atMs: 2_600, seqs: [1] }]);
    expect(store.countPending()).toBe(0);
  });

  it("coalesces a synchronous append burst and never uploads inline or before start", async () => {
    const { uploads } = scheduledDrain(true);
    emit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads).toEqual([]);
    drain.start();
    emit(2);
    emit(3, "terminal");
    expect(uploads).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads.map(call => call.seqs)).toEqual([[1, 2, 3]]);
  });

  it("a wake for another stream during upload is latched into one subsequent pass", async () => {
    const { uploads, behavior } = scheduledDrain(true);
    drain.start();
    await vi.advanceTimersByTimeAsync(1_500);
    let release!: () => void;
    behavior.gate = new Promise<void>(resolve => { release = resolve; });
    emit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads).toHaveLength(1);
    const other = eventIdentity({ jobId: "00000000-0000-4000-8000-000000000088" });
    sink.emit(stampEvent(other, 1, "terminal", samplePayloadFor("terminal")));
    drain.wake();
    drain.wake();
    expect(uploads).toHaveLength(1);
    behavior.gate = null;
    release();
    // Wait for the shared active pass, then fire the single latched wake.
    await drain.drainOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads).toHaveLength(2);
    expect(store.getStream(deriveStreamKey(other))?.acceptedThroughSeq).toBe(1);
    expect(behavior.maxActive).toBe(1);
  });

  it("append wakes cannot bypass the persisted head backoff or change its retry key", async () => {
    const { uploads, behavior } = scheduledDrain(true);
    drain.start();
    await vi.advanceTimersByTimeAsync(1_500);
    behavior.failures = 1;
    emit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads).toHaveLength(1);
    const retryAt = store.getRow(STREAM_KEY, 1)?.nextRetryAt;
    expect(retryAt).toBe(Date.now() + 5_000);
    emit(2, "terminal");
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads).toHaveLength(1);
    expect(store.getRow(STREAM_KEY, 1)?.nextRetryAt).toBe(retryAt);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(uploads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await drain.drainOnce();
    expect(uploads.map(call => call.seqs)).toEqual([[1], [1, 2]]);
    expect(uploads[1]!.key).toBe(uploads[0]!.key);
    expect(store.countPending()).toBe(0);
  });

  it("a periodic timer joining a manual pass cannot consume another stream's latched append", async () => {
    const { uploads, behavior } = scheduledDrain(true);
    let release!: () => void;
    behavior.gate = new Promise<void>(resolve => { release = resolve; });
    emit(1); // before start: only the deferred safety timer exists
    drain.start();
    const manual = drain.drainOnce();
    await vi.advanceTimersByTimeAsync(0);
    const other = eventIdentity({ jobId: "00000000-0000-4000-8000-000000000089" });
    sink.emit(stampEvent(other, 1, "terminal", samplePayloadFor("terminal")));
    await vi.advanceTimersByTimeAsync(1_500); // timer joins the still-blocked pass
    expect(uploads).toHaveLength(1);
    behavior.gate = null;
    release();
    await manual;
    await vi.advanceTimersByTimeAsync(1);
    expect(uploads).toHaveLength(2); // no additional idle interval
    expect(store.getStream(deriveStreamKey(other))?.acceptedThroughSeq).toBe(1);
    expect(behavior.maxActive).toBe(1);
  });

  it("an append between shared-pass settlement and tick continuation creates only one subsequent idle timer", async () => {
    const { uploads, behavior } = scheduledDrain(true);
    const passes = vi.spyOn(store, "listActiveStreams");
    let release!: () => void;
    behavior.gate = new Promise<void>(resolve => { release = resolve; });
    emit(1);
    drain.start();
    const manual = drain.drainOnce();
    const other = eventIdentity({ jobId: "00000000-0000-4000-8000-000000000090" });
    // Registered before the timer joins: this callback runs after the pass's
    // settlement handler clears activePass, but before tick's await continues.
    void manual.then(() => sink.emit(stampEvent(other, 1, "terminal", samplePayloadFor("terminal"))));
    await vi.advanceTimersByTimeAsync(1_500);
    behavior.gate = null;
    release();
    await manual;
    await vi.advanceTimersByTimeAsync(1);
    expect(uploads).toHaveLength(2);
    const completedPasses = passes.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(passes.mock.calls.length - completedPasses).toBe(1);
  });

  it("manual passes are single-flight and stop/flush waits for old ACK before final append delivery", async () => {
    const { uploads, behavior } = scheduledDrain(true);
    drain.start();
    await vi.advanceTimersByTimeAsync(1_500);
    let release!: () => void;
    behavior.gate = new Promise<void>(resolve => { release = resolve; });
    emit(1);
    await vi.advanceTimersByTimeAsync(0);
    const first = drain.drainOnce(), second = drain.drainOnce();
    emit(2, "terminal");
    drain.stop();
    const flush = drain.flush();
    drain.wake();
    drain.start(); // stop is latched, not a restart
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads).toHaveLength(1);
    behavior.gate = null;
    release();
    await Promise.all([first, second, flush]);
    expect(uploads.map(call => call.seqs)).toEqual([[1], [2]]);
    expect(store.getStream(STREAM_KEY)?.acceptedThroughSeq).toBe(2);
    expect(behavior.maxActive).toBe(1);
    emit(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(uploads).toHaveLength(2);
    expect(store.getRow(STREAM_KEY, 3)?.status).toBe("pending");
  });
});

describe("event-outbox-drain — upload in seq order, advance cursor, classify (slice 4)", () => {
  it("accepted → advances the durable cursor + prunes; builds a valid contiguous batch", async () => {
    emit(1);
    emit(2);
    emit(3);
    const summary = await drain.drainOnce();

    expect(summary.eventsAccepted).toBe(1);
    // The plane received ONE contiguous batch (1..3) — the frozen schema validated it.
    expect(fake.eventUploads()).toHaveLength(1);
    expect(fake.eventUploads()[0]!).toMatchObject({ firstSeq: 1, lastSeq: 3, count: 3 });
    // Durable cursor advanced + rows pruned.
    expect(store.getStream(STREAM_KEY)!.acceptedThroughSeq).toBe(3);
    expect(store.allRows(STREAM_KEY)).toHaveLength(0);
    expect(fake.eventStreamAcceptedThrough(STREAM_KEY)).toBe(3);
  });

  it("gap → advances to acceptedThroughSeq and resends from expectedNextSeq next tick", async () => {
    emit(1);
    emit(2);
    emit(3);
    // Server already holds seq 1; it expects the next batch to start at 2.
    fake.enqueueEventUpload({ kind: "gap", acceptedThroughSeq: 1 });
    await drain.drainOnce();
    expect(store.getStream(STREAM_KEY)!.acceptedThroughSeq).toBe(1);
    expect(store.getRow(STREAM_KEY, 1)).toBeNull(); // pruned
    expect(store.getRow(STREAM_KEY, 2)!.status).toBe("pending"); // reverted, resendable

    // Next pass (default accept) resends from seq 2 and finishes.
    await drain.drainOnce();
    expect(store.getStream(STREAM_KEY)!.acceptedThroughSeq).toBe(3);
    expect(fake.eventUploads()[1]!).toMatchObject({ firstSeq: 2, lastSeq: 3 });
  });

  it("hash_mismatch → quarantines the rejected event id and STOPS the stream", async () => {
    emit(1);
    const evt2 = stampEvent(IDENTITY, 2, "log", samplePayloadFor("log"));
    sink.emit(evt2);
    emit(3);
    fake.enqueueEventUpload({ kind: "hash_mismatch", rejectedEventId: evt2.eventId });
    await drain.drainOnce();

    expect(store.getRow(STREAM_KEY, 2)!.status).toBe("quarantined");
    expect(store.getStream(STREAM_KEY)!.stopped).toBe(true);
    expect(store.getStream(STREAM_KEY)!.stopReason).toBe("hash_mismatch");
    expect(store.listActiveStreams()).toHaveLength(0);
  });

  it("stale_fence / target_revoked / terminal ACK → stop the stream (converge)", async () => {
    for (const reason of ["stale_fence", "target_revoked", "terminal"] as const) {
      const d = mkdtempSync(join(tmpdir(), "aoa-stop-"));
      const s = await openEventOutboxStore({ path: join(d, "e.db"), now: () => clock.ms });
      const sk = new DurableWorkerEventSink({ store: s, kek: KEK, now: () => clock.ms });
      const dr = createEventOutboxDrain({ store: s, client, session: staticSessionProvider(session), key, kek: KEK, now: () => clock.ms });
      sk.emit(stampEvent(IDENTITY, 1, "log", samplePayloadFor("log")));
      fake.enqueueEventUpload({ kind: reason });
      await dr.drainOnce();
      expect(s.getStream(STREAM_KEY)!.stopped, reason).toBe(true);
      expect(s.getStream(STREAM_KEY)!.stopReason, reason).toBe(reason);
      s.close();
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("transient → re-queues with a persisted backoff and REUSES the same idempotency key (D6)", async () => {
    emit(1);
    emit(2);
    fake.enqueueEventUpload({ kind: "error", status: 503, code: "internal_unavailable", retryAfterMs: 5_000 });
    await drain.drainOnce();

    // Re-queued (not stopped, not accepted): pending, attempts bumped, next_retry_at set.
    const row1 = store.getRow(STREAM_KEY, 1)!;
    expect(row1.status).toBe("pending");
    expect(row1.attempts).toBe(1);
    expect(row1.nextRetryAt).toBe(clock.ms + 5_000);
    // Not eligible yet (backoff in force) → no upload this tick.
    await drain.drainOnce();
    expect(fake.eventUploadCount()).toBe(1);

    // Advance past the backoff → the retry uses the SAME idempotency key.
    clock.ms += 6_000;
    await drain.drainOnce();
    expect(store.getStream(STREAM_KEY)!.acceptedThroughSeq).toBe(2);
    expect(fake.eventUploadKeys()).toHaveLength(1); // one key across the transient retry
  });

  it("graceful-shutdown flush() delivers pending events EVEN AFTER stop() (the final flush is not a no-op)", async () => {
    // Regression: the shutdown order is stop → flush → close. stop() latches the loop's
    // cooperative-cancel guard; flush() must still run one full pass (final=true) so the
    // last durably-persisted events get a delivery attempt instead of waiting for reboot.
    emit(1);
    emit(2);
    emit(3);
    drain.stop();
    await drain.flush();

    expect(store.getStream(STREAM_KEY)!.acceptedThroughSeq).toBe(3);
    expect(store.allRows(STREAM_KEY)).toHaveLength(0); // pruned after ACK
    expect(fake.eventUploads()).toHaveLength(1); // the final flush actually uploaded
  });

  it("401 → recovers under a PER-STREAM cap, then stops the stream when capped", async () => {
    emit(1);
    const controllable = {
      get: async () => session,
      recover: (() => {
        let n = 0;
        return async () => {
          n += 1;
          (controllable as { recovers: number }).recovers = n;
          return session;
        };
      })(),
      recovers: 0,
    } as unknown as ReturnType<typeof staticSessionProvider> & { recovers: number };

    const d = await buildDrain(controllable, 3);
    fake.forceEventUploadUnauthorized(true);
    await d.drainOnce();

    expect((controllable as unknown as { recovers: number }).recovers).toBe(3);
    expect(store.getStream(STREAM_KEY)!.stopped).toBe(true);
    expect(store.getStream(STREAM_KEY)!.stopReason).toBe("reenrollment_required");
  });
});
