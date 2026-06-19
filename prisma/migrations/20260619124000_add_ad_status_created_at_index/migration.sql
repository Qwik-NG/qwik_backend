-- Add a composite index for the hottest public ads query:
-- WHERE status = 'ACTIVE' ORDER BY createdAt DESC LIMIT pageSize
CREATE INDEX "Ad_status_createdAt_idx" ON "Ad"("status", "createdAt");