-- Make passwordHash nullable so Google-only users do not require a local password
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- Add Google identity fields
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN "authProvider" TEXT;

CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
