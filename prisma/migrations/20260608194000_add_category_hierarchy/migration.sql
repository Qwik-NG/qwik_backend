-- Add category hierarchy support for parent and child categories.
ALTER TABLE "Category" ADD COLUMN "parentId" TEXT;

CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

ALTER TABLE "Category"
ADD CONSTRAINT "Category_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "Category"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Align existing category rows to the canonical taxonomy when possible.
UPDATE "Category"
SET "name" = 'Vehicles', "slug" = 'vehicles'
WHERE "slug" = 'cars'
AND NOT EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'vehicles');

UPDATE "Category"
SET "name" = 'Furniture & Appliances', "slug" = 'furniture-appliances'
WHERE "slug" = 'furniture'
AND NOT EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'furniture-appliances');

INSERT INTO "Category" ("id", "name", "slug", "createdAt")
VALUES
  ('cat_properties', 'Properties', 'properties', CURRENT_TIMESTAMP),
  ('cat_vehicles', 'Vehicles', 'vehicles', CURRENT_TIMESTAMP),
  ('cat_phones_tablets', 'Phones & Tablets', 'phones-tablets', CURRENT_TIMESTAMP),
  ('cat_electronics', 'Electronics', 'electronics', CURRENT_TIMESTAMP),
  ('cat_fashion', 'Fashion', 'fashion', CURRENT_TIMESTAMP),
  ('cat_beauty', 'Beauty', 'beauty', CURRENT_TIMESTAMP),
  ('cat_furniture_appliances', 'Furniture & Appliances', 'furniture-appliances', CURRENT_TIMESTAMP),
  ('cat_jobs', 'Jobs', 'jobs', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE
SET "name" = EXCLUDED."name", "parentId" = NULL;

INSERT INTO "Category" ("id", "name", "slug", "parentId", "createdAt")
VALUES
  ('cat_laptops', 'Laptops', 'laptops', (SELECT "id" FROM "Category" WHERE "slug" = 'electronics'), CURRENT_TIMESTAMP),
  ('cat_desktop_computers', 'Desktop Computers', 'desktop-computers', (SELECT "id" FROM "Category" WHERE "slug" = 'electronics'), CURRENT_TIMESTAMP),
  ('cat_servers', 'Servers', 'servers', (SELECT "id" FROM "Category" WHERE "slug" = 'electronics'), CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE
SET "name" = EXCLUDED."name", "parentId" = EXCLUDED."parentId";
