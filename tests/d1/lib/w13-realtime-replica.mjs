// Two separate processes compose the shipped authenticated socket server/store/broker.
// IPC is test control only; no mock WebSocket, authorization function or event store.
import { createServer } from 'node:http';
import { createDb } from '../../../packages/db/src/index.ts';
import { setupLiveEventsWebSocketServer } from '../../../server/src/realtime/live-events-ws.ts';
import { createLiveEventLogStore } from '../../../server/src/services/live-event-log-store.ts';
import { setLiveEventLogStore, wasLocallyPublished } from '../../../server/src/services/live-events.ts';
import { createBrokerDrainer, attachLiveEventBrokerListener } from '../../../server/src/services/live-event-broker-listener.ts';

const db = createDb(process.env.AOA_W13_DATABASE_URL);
const store = createLiveEventLogStore(db);
setLiveEventLogStore(store);
const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
const wss = setupLiveEventsWebSocketServer(server, db, { deploymentMode: 'authenticated' });
const drainer = createBrokerDrainer({ store, fanout: (company, event) => wss.deliverDurableEvent(company, event), isLocallyPublished: wasLocallyPublished });
let listener;
async function startBroker() {
  listener = await attachLiveEventBrokerListener({ db, drainer, activeCompanies: () => wss.activeCompanies(), pollIntervalMs: 100 });
}
await startBroker();
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
    } else if (message.action === 'brokerStop') { await listener?.stop(); listener = null; result = true; }
    else if (message.action === 'brokerStart') { if (!listener) await startBroker(); result = true; }
    else if (message.action === 'redeliver') {
      const rows = await store.since(message.companyId, message.sinceSeq, message.limit);
      for (const row of rows) wss.deliverDurableEvent(message.companyId, row);
      result = rows.length;
    } else if (message.action === 'status') {
      result = { sockets: wss.clients.size, bufferedBytes: [...wss.clients].map(s => s.bufferedAmount) };
    } else if (message.action === 'trim') { result = await store.trimRetention(message.window, message.companies); }
    else if (message.action === 'stop') {
      await listener?.stop();
      for (const socket of wss.clients) socket.terminate();
      await new Promise(r => wss.close(r));
      await new Promise(r => server.close(r));
      await db.$client.end({ timeout: 5 });
      process.send({ id: message.id, result: true }); process.disconnect(); return;
    } else throw Error('Unknown harness command');
    process.send({ id: message.id, result });
  }).catch(error => { process.send({ id: message.id, error: error.message }); });
});
