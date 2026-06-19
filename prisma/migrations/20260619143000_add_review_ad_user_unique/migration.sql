-- Enforce one review per user per ad at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS "Review_adId_userId_key" ON "Review"("adId", "userId");
