import type { Job } from "bullmq";
import type { WebhookJobData } from "../queues";

function log(message: string, extra?: Record<string, unknown>): void {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[webhooks-worker] ${message}${payload}`);
}

export async function processWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  log("stub deliver webhook", {
    jobId: job.id,
    url: job.data.url,
    runId: job.data.runId,
  });
}
