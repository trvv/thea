/** Fixed-size source scans yield real tasks so cancellation messages can be observed. */
export const scanChunkSize = 65536;
export const mapEntryEstimate = 96;

export async function yieldScan(current = () => true) {
  if (!current()) return false;
  if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
  else if (typeof MessageChannel === "function") {
    await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  } else await new Promise((resolve) => setTimeout(resolve, 0));
  return current();
}
