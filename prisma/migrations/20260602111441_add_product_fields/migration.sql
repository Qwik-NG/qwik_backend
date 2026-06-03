-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "condition" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "specifications" JSONB;
