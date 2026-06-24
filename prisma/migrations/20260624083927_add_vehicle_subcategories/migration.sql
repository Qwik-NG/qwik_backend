-- Add Vehicles category subcategories: Cars, Motorcycles, Trucks & Buses
-- Idempotent: safely handles existing categories and creates missing ones

-- Update existing flat 'Cars' category to be child of Vehicles (if it exists as top-level)
UPDATE "Category" c1
SET "parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'vehicles' AND "parentId" IS NULL LIMIT 1)
WHERE c1."slug" = 'cars'
  AND c1."parentId" IS NULL;

-- Update existing flat 'Motorcycles' category to be child of Vehicles (if it exists as top-level)
UPDATE "Category" c2
SET "parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'vehicles' AND "parentId" IS NULL LIMIT 1)
WHERE c2."slug" = 'motorcycles'
  AND c2."parentId" IS NULL;

-- Update existing flat 'Trucks & Buses' category to be child of Vehicles (if it exists as top-level)
UPDATE "Category" c3
SET "parentId" = (SELECT "id" FROM "Category" WHERE "slug" = 'trucks-buses' LIMIT 1)
WHERE c3."slug" = 'trucks-buses'
  AND c3."parentId" IS NULL;

-- Insert missing subcategories
INSERT INTO "Category" ("name", "slug", "parentId", "createdAt")
SELECT 'Cars', 'cars', "id", CURRENT_TIMESTAMP FROM "Category" WHERE "slug" = 'vehicles' AND "parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Category" ("name", "slug", "parentId", "createdAt")
SELECT 'Motorcycles', 'motorcycles', "id", CURRENT_TIMESTAMP FROM "Category" WHERE "slug" = 'vehicles' AND "parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Category" ("name", "slug", "parentId", "createdAt")
SELECT 'Trucks & Buses', 'trucks-buses', "id", CURRENT_TIMESTAMP FROM "Category" WHERE "slug" = 'vehicles' AND "parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;
