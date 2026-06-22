DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
    CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
  END IF;
END $$;

DO $$
DECLARE
  role_col_exists BOOLEAN;
  role_udt_name TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'role'
  ) INTO role_col_exists;

  IF NOT role_col_exists THEN
    ALTER TABLE "User" ADD COLUMN "role" "UserRole";
  END IF;

  SELECT c.udt_name
  INTO role_udt_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'User'
    AND c.column_name = 'role';

  IF role_udt_name <> 'UserRole' THEN
    RAISE EXCEPTION 'User.role exists with unexpected type %, expected UserRole', role_udt_name;
  END IF;

  UPDATE "User"
  SET "role" = 'USER'::"UserRole"
  WHERE "role" IS NULL;

  ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';
  ALTER TABLE "User" ALTER COLUMN "role" SET NOT NULL;
END $$;
