import { startAutomationWorker } from "./worker";

const worker = startAutomationWorker();
console.log("[automation-worker] listening on queue zts-workflows");

async function shutdown() {
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
