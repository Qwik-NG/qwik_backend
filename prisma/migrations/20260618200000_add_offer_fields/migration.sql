-- Add offer-related fields to Message table
ALTER TABLE "Message" ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "Message" ADD COLUMN "offerAmount" INTEGER;
ALTER TABLE "Message" ADD COLUMN "offerStatus" TEXT;

-- Create index for efficient filtering by messageType
CREATE INDEX "Message_messageType_idx" ON "Message"("messageType");
