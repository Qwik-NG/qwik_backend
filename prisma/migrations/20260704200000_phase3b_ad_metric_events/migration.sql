-- Phase 3B: Ad Performance Telemetry
-- Safe production migration — adds new table and enum only.
-- No destructive changes to existing tables.
-- Apply via: npx prisma db execute --file ./prisma/migrations/20260704200000_phase3b_ad_metric_events/migration.sql

-- New enum for telemetry event types
CREATE TYPE "AdMetricEventType" AS ENUM ('AD_VIEW', 'CONTACT_CLICK', 'PROFILE_VISIT');

-- New telemetry events table
CREATE TABLE "AdMetricEvent" (
	"id" TEXT NOT NULL,
	"adId" TEXT,
	"sellerId" TEXT NOT NULL,
	"eventType" "AdMetricEventType" NOT NULL,
	"viewerId" TEXT,
	"viewerFingerprint" TEXT,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

	CONSTRAINT "AdMetricEvent_pkey" PRIMARY KEY ("id")
);

-- Aggregation index: per-ad metrics by event type over time
CREATE INDEX "AdMetricEvent_adId_eventType_createdAt_idx" ON "AdMetricEvent"("adId", "eventType", "createdAt");

-- Aggregation index: per-seller metrics (profile visits) by event type over time
CREATE INDEX "AdMetricEvent_sellerId_eventType_createdAt_idx" ON "AdMetricEvent"("sellerId", "eventType", "createdAt");

-- Dedup index: authenticated viewer per-ad event within window
CREATE INDEX "AdMetricEvent_viewerId_adId_eventType_createdAt_idx" ON "AdMetricEvent"("viewerId", "adId", "eventType", "createdAt");

-- Dedup index: anonymous fingerprint per-ad event within window
CREATE INDEX "AdMetricEvent_viewerFingerprint_adId_eventType_createdAt_idx" ON "AdMetricEvent"("viewerFingerprint", "adId", "eventType", "createdAt");

-- Dedup index: authenticated viewer per-seller profile visit within window
CREATE INDEX "AdMetricEvent_viewerId_sellerId_eventType_createdAt_idx" ON "AdMetricEvent"("viewerId", "sellerId", "eventType", "createdAt");

-- Dedup index: anonymous fingerprint per-seller profile visit within window
CREATE INDEX "AdMetricEvent_viewerFingerprint_sellerId_eventType_createdAt_idx" ON "AdMetricEvent"("viewerFingerprint", "sellerId", "eventType", "createdAt");

-- Range/cleanup index
CREATE INDEX "AdMetricEvent_createdAt_idx" ON "AdMetricEvent"("createdAt");

-- FK: optional ad reference (null for PROFILE_VISIT events)
ALTER TABLE "AdMetricEvent" ADD CONSTRAINT "AdMetricEvent_adId_fkey"
	FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: seller (the listing owner or profile owner)
ALTER TABLE "AdMetricEvent" ADD CONSTRAINT "AdMetricEvent_sellerId_fkey"
	FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: authenticated viewer (nullable)
ALTER TABLE "AdMetricEvent" ADD CONSTRAINT "AdMetricEvent_viewerId_fkey"
	FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
