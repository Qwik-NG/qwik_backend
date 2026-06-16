-- AddColumn: locationState (nullable)
ALTER TABLE "Ad" ADD COLUMN "locationState" TEXT;

-- AddColumn: locationArea (nullable)
ALTER TABLE "Ad" ADD COLUMN "locationArea" TEXT;

-- CreateIndex: locationState
CREATE INDEX "Ad_locationState_idx" ON "Ad"("locationState");

-- CreateIndex: locationArea
CREATE INDEX "Ad_locationArea_idx" ON "Ad"("locationArea");
