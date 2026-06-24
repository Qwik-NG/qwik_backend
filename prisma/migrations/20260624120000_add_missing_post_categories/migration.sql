-- Add missing top-level post-ad categories: Agriculture & Food, Sports & Leisure, Art
-- Idempotent: ON CONFLICT DO NOTHING ensures safe re-runs and no duplicates

INSERT INTO "Category" ("id", "name", "slug", "parentId", "createdAt")
VALUES
  (gen_random_uuid()::text, 'Agriculture & Food', 'agriculture', NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Sports & Leisure',   'sports-leisure', NULL, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Art',                'art',            NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
