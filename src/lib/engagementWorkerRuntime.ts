import { env } from "../config/env";
import { processPendingEmailOutboxJobs } from "./engagementWorker";

export function startEngagementOutboxWorker() {
  if (!env.engagementOutboxWorkerEnabled) {
    console.info("[engagement-outbox] Auto worker disabled by ENGAGEMENT_OUTBOX_WORKER_ENABLED=false");
    return () => {};
  }

  const intervalMs = env.engagementOutboxWorkerIntervalMs;
  const batchSize = env.engagementOutboxWorkerBatchSize;
  let isProcessing = false;

  const runOnce = async (trigger: "startup" | "interval") => {
    if (isProcessing) {
      console.info("[engagement-outbox] Skipping run because previous run is still in progress", { trigger });
      return;
    }

    isProcessing = true;
    const workerId = `auto-${trigger}-${process.pid}-${Date.now()}`;

    try {
      const summary = await processPendingEmailOutboxJobs({
        batchSize,
        workerId,
      });
      console.info("[engagement-outbox] Auto run completed", { trigger, workerId, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[engagement-outbox] Auto run failed", { trigger, workerId, error: message });
    } finally {
      isProcessing = false;
    }
  };

  console.info("[engagement-outbox] Auto worker started", {
    intervalMs,
    batchSize,
    enabled: env.engagementEmailsEnabled,
    dryRun: env.engagementEmailDryRun,
  });

  void runOnce("startup");
  const timer = setInterval(() => {
    void runOnce("interval");
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return () => {
    clearInterval(timer);
    console.info("[engagement-outbox] Auto worker stopped");
  };
}
