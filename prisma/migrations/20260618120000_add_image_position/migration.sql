-- AlterTable
ALTER TABLE "AdImage" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AdImage_adId_position_idx" ON "AdImage"("adId", "position");
