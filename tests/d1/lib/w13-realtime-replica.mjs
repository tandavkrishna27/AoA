// Two separate processes compose the shipped authenticated socket server/store/broker.
// IPC is test control only; no mock WebSocket, authorization function or event store.
import { createServer } from 'node:http';
import { createDb } from '../../../packages/db/src/index.ts';
import { setupLiveEventsWebSocketServer } from '../../../server/src/realtime/live-events-ws.ts';
import { createLiveEventLogStore } from '../../../server/src/services/live-event-log-store.ts';
import { setLiveEventLogStore, wasLocallyPublished } from '../../../server/src/services/live-events.ts';
import { createBrokerDrainer, attachLiveEventBrokerListener } from '../../../server/src/services/live-event-broker-listener.ts';

const actualDb = createDb(process.env.AOA_W13_DATABASE_URL);
const authorizationReads = [];
// Test-only observation of genuine completed authorization queries. The proxy
// delegates every query/result unchanged; it does not replace the authorizer.
function observeSelect(builder) {
  return new Proxy(builder, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key === 'then') return (fulfilled, rejected) => {
        const query = target.toSQL();
        return value.call(target, rows => {
          const table = query.sql.includes('from "thread_participants"') ? 'participants'
            : query.sql.includes('from "discussions"') ? 'discussion' : null;
          if (table) authorizationReads.push({ table, parameters: query.params, rows: rows.length, completedAt: new Date().toISOString() });
          return fulfilled ? fulfilled(rows) : rows;
        }, rejected);
      };
      if (typeof value === 'function') return (...args) => {
        const next = value.apply(target, args);
        return next && typeof next.toSQL === 'function' ? observeSelect(next) : next;
      };
      return value;
    },
  });
}
const db = new Proxy(actualDb, {
  get(target, key, receiver) {
    if (key === 'select') return (...args) => observeSelect(target.select(...args));
    return Reflect.get(target, key, receiver);
  },
});
const store = createLiveEventLogStore(db);
setLiveEventLogStore(store);
const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
const wss = setupLiveEventsWebSocketServer(server, db, { deploymentMode: 'authenticated' });
const productionDrainer = createBrokerDrainer({ store, fanout: (company, event) => wss.deliverDurableEvent(company, event), isLocallyPublished: wasLocallyPublished });
const pendingDrains = new Set();
let drainStarts = 0, drainSettlements = 0;
// Observe the actual production drain promises without replacing their reads,
// fanout, coalescing, or per-company cursor behavior.
const drainer = { drain(...args) {
  const operation = productionDrainer.drain(...args);
  drainStarts++; pendingDrains.add(operation);
  const settled = () => { pendingDrains.delete(operation); drainSettlements++; };
  operation.then(settled, settled);
  return operation;
} };
let listener;
async function startBroker() {
  listener = await attachLiveEventBrokerListener({ db, drainer, activeCompanies: () => wss.activeCompanies(), pollIntervalMs: 100 });
}
await startBroker();
async function stopBroker(probeId) {
  await listener?.stop(); listener = null;
  const pendingAtStop = pendingDrains.size;
  if (probeId) process.send({ observation: { probeId, pendingAtStop } });
  // Listener.stop removes wake/poll producers, but does not join drains they
  // already started. Join those real promises before admitting outage writes.
  do {
    await Promise.all([...pendingDrains]);
    await new Promise(resolve => setImmediate(resolve));
  } while (pendingDrains.size > 0);
  return { stopped: true, pendingAtStop, pending: pendingDrains.size, drainStarts, drainSettlements, stoppedAt: new Date().toISOString() };
}
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.send({ ready: true, port: server.address().port });
let chain = Promise.resolve();
process.on('message', message => {
  chain = chain.then(async () => {
    let result;
    if (message.action === 'append') {
      const rows = [];
      for (const record of message.records) {
        const seq = await store.append(record);
        if (message.notify !== false) await store.notify(record.companyId, seq);
        rows.push({ eventId: record.eventId, companyId: record.companyId, seq });
      }
      result = rows;
    } else if (message.action === 'brokerStop') { result = await stopBroker(message.probeId); }
    else if (message.action === 'brokerStart') { if (!listener) await startBroker(); result = true; }
    else if (message.action === 'drainStart') {
      void drainer.drain(message.companyId).catch(() => {});
      result = { pending: pendingDrains.size };
    }
    else if (message.action === 'redeliver') {
      const rows = await store.since(message.companyId, message.sinceSeq, message.limit);
      for (const row of rows) wss.deliverDurableEvent(message.companyId, row);
      result = rows.length;
    } else if (message.action === 'status') {
      result = { sockets: wss.clients.size, bufferedBytes: [...wss.clients].map(s => s.bufferedAmount) };
    } else if (message.action === 'subscriptionBarrier') {
      const seen = (thread, table, rows) => authorizationReads.some(r => r.table === table && r.parameters.includes(thread) && r.rows === rows);
      const complete = () => seen(message.privateThread, 'discussion', 1) && seen(message.privateThread, 'participants', 0)
        && seen(message.foreignThread, 'discussion', 0) && seen(message.publicThread, 'discussion', 1) && seen(message.publicThread, 'participants', 0);
      const deadline = Date.now() + 20_000;
      while (!complete()) {
        if (Date.now() >= deadline) throw Error('Subscription authorizer query barrier timed out');
        await new Promise(resolve => setImmediate(resolve));
      }
      // Genuine query fulfillment schedules the remaining authorizer/registry
      // Promise continuations. One event-loop turn drains those microtasks.
      await new Promise(resolve => setImmediate(resolve));
      result = { resolved: true, reads: authorizationReads.filter(r => [message.privateThread, message.foreignThread, message.publicThread].some(t => r.parameters.includes(t))) };
    } else if (message.action === 'trim') { result = await store.trimRetention(message.window, message.companies); }
    else if (message.action === 'stop') {
      await stopBroker();
      for (const socket of wss.clients) socket.terminate();
      await new Promise(r => wss.close(r));
      await new Promise(r => server.close(r));
      await db.$client.end({ timeout: 5 });
      process.send({ id: message.id, result: true }); process.disconnect(); return;
    } else throw Error('Unknown harness command');
    process.send({ id: message.id, result });
  }).catch(error => { process.send({ id: message.id, error: error.message }); });
});
