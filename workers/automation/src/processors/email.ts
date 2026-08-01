import type { Job } from "bullmq";
import type { EmailJobData } from "../queues";

function log(message: string, extra?: Record<string, unknown>): void {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[email-worker] ${message}${payload}`);
}

export async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  log("stub send email", {
    jobId: job.id,
    to: job.data.to,
    subject: job.data.subject,
  });
}
