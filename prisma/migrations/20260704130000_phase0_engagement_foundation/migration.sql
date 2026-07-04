-- Phase 0 Engagement Foundation
-- Generated from prisma/schema.prisma delta for manual application.

-- Create enums
CREATE TYPE "EngagementEventType" AS ENUM ('NEW_MESSAGE', 'NEW_OFFER', 'AD_PERFORMANCE_REPORT');

CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY', 'SENT', 'FAILED', 'CANCELLED');

CREATE TYPE "EmailDeliveryAttemptStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED', 'DRY_RUN');

-- Create tables
CREATE TABLE "NotificationEventFingerprint" (
	"id" TEXT NOT NULL,
	"fingerprint" TEXT NOT NULL,
	"eventType" "EngagementEventType" NOT NULL,
	"recipientId" TEXT NOT NULL,
	"payload" JSONB,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

	CONSTRAINT "NotificationEventFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailOutboxJob" (
	"id" TEXT NOT NULL,
	"eventType" "EngagementEventType" NOT NULL,
	"status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
	"recipientId" TEXT NOT NULL,
	"recipientEmail" TEXT NOT NULL,
	"subject" TEXT NOT NULL,
	"htmlBody" TEXT,
	"textBody" TEXT,
	"actionUrl" TEXT,
	"payload" JSONB,
	"fingerprint" TEXT NOT NULL,
	"notificationEventFingerprintId" TEXT,
	"availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"nextAttemptAt" TIMESTAMP(3),
	"lockedAt" TIMESTAMP(3),
	"lockedBy" TEXT,
	"attemptCount" INTEGER NOT NULL DEFAULT 0,
	"maxAttempts" INTEGER NOT NULL DEFAULT 5,
	"lastError" TEXT,
	"providerMessageId" TEXT,
	"sentAt" TIMESTAMP(3),
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP(3) NOT NULL,

	CONSTRAINT "EmailOutboxJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailDeliveryAttempt" (
	"id" TEXT NOT NULL,
	"outboxJobId" TEXT NOT NULL,
	"attemptNumber" INTEGER NOT NULL,
	"status" "EmailDeliveryAttemptStatus" NOT NULL,
	"providerMessageId" TEXT,
	"error" TEXT,
	"responsePayload" JSONB,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

	CONSTRAINT "EmailDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- Create uniques
CREATE UNIQUE INDEX "NotificationEventFingerprint_fingerprint_key" ON "NotificationEventFingerprint"("fingerprint");
CREATE UNIQUE INDEX "EmailOutboxJob_fingerprint_key" ON "EmailOutboxJob"("fingerprint");
CREATE UNIQUE INDEX "EmailDeliveryAttempt_outboxJobId_attemptNumber_key" ON "EmailDeliveryAttempt"("outboxJobId", "attemptNumber");

-- Create indexes
CREATE INDEX "NotificationEventFingerprint_recipientId_idx" ON "NotificationEventFingerprint"("recipientId");
CREATE INDEX "NotificationEventFingerprint_eventType_idx" ON "NotificationEventFingerprint"("eventType");
CREATE INDEX "NotificationEventFingerprint_createdAt_idx" ON "NotificationEventFingerprint"("createdAt");

CREATE INDEX "EmailOutboxJob_status_availableAt_idx" ON "EmailOutboxJob"("status", "availableAt");
CREATE INDEX "EmailOutboxJob_status_nextAttemptAt_idx" ON "EmailOutboxJob"("status", "nextAttemptAt");
CREATE INDEX "EmailOutboxJob_recipientId_idx" ON "EmailOutboxJob"("recipientId");
CREATE INDEX "EmailOutboxJob_createdAt_idx" ON "EmailOutboxJob"("createdAt");

CREATE INDEX "EmailDeliveryAttempt_outboxJobId_idx" ON "EmailDeliveryAttempt"("outboxJobId");
CREATE INDEX "EmailDeliveryAttempt_status_idx" ON "EmailDeliveryAttempt"("status");
CREATE INDEX "EmailDeliveryAttempt_createdAt_idx" ON "EmailDeliveryAttempt"("createdAt");

-- Create foreign keys
ALTER TABLE "NotificationEventFingerprint"
ADD CONSTRAINT "NotificationEventFingerprint_recipientId_fkey"
FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailOutboxJob"
ADD CONSTRAINT "EmailOutboxJob_recipientId_fkey"
FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailOutboxJob"
ADD CONSTRAINT "EmailOutboxJob_notificationEventFingerprintId_fkey"
FOREIGN KEY ("notificationEventFingerprintId") REFERENCES "NotificationEventFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmailDeliveryAttempt"
ADD CONSTRAINT "EmailDeliveryAttempt_outboxJobId_fkey"
FOREIGN KEY ("outboxJobId") REFERENCES "EmailOutboxJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
