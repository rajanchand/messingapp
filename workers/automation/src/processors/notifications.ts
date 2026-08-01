import type { Job } from "bullmq";
import type { NotificationJobData } from "../queues";

function log(message: string, extra?: Record<string, unknown>): void {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[notifications-worker] ${message}${payload}`);
}

export async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  log("stub send notification", {
    jobId: job.id,
    title: job.data.title,
    userId: job.data.userId,
  });
}
