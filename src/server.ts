import { app } from "./app";
import { env } from "./config/env";
import { createServer } from "http";
import { initRealtime } from "./lib/realtime";
import { startEngagementOutboxWorker } from "./lib/engagementWorkerRuntime";

const server = createServer(app);
initRealtime(server);
startEngagementOutboxWorker();

server.listen(env.port, () => {
  console.log(`Qwik backend listening on http://localhost:${env.port}`);
  console.log("[engagement-outbox] Manual trigger endpoint ready at POST /api/internal/engagement/process-outbox");
});
