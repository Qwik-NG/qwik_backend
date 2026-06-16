-- AlterTable
ALTER TABLE "User" ADD COLUMN "locationState" TEXT;
ALTER TABLE "User" ADD COLUMN "locationArea" TEXT;

-- CreateIndex
CREATE INDEX "User_locationState_idx" ON "User"("locationState");
