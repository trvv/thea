/** Lease one render worker across canvases; messages and cancellation remain per engine. */
let worker;
let serial = 0;
const clients = new Map();
const sourceIds = new WeakMap();
let sourceSerial = 0;
export function sharedSourceId(source) {
  if (!sourceIds.has(source)) sourceIds.set(source, ++sourceSerial);
  return sourceIds.get(source);
}
export function sharedRenderWorker() {
  if (!worker) {
    worker = new Worker(new URL("./render-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const client = clients.get(data.channel);
      if (client) client.onmessage?.({ data });
      else data.bitmap?.close();
    };
    const failed = (event) => {
      for (const client of [...clients.values()]) client.onerror?.(event);
    };
    worker.onerror = failed;
    worker.onmessageerror = failed;
  }
  const channel = ++serial;
  const owner = worker;
  const client = {
    postMessage(data) {
      owner.postMessage({ ...data, channel });
    },
    terminate() {
      if (!clients.delete(channel)) return;
      owner.postMessage({ channel, disconnect: true });
      if (!clients.size) {
        owner.terminate();
        if (worker === owner) worker = undefined;
      }
    },
  };
  clients.set(channel, client);
  return client;
}
