import { describe, expect, it } from "vitest";
import { getDatabaseUrl } from "../lib/prisma";

describe("getDatabaseUrl", () => {
  it("returns undefined when no URL is available", () => {
    expect(getDatabaseUrl("")).toBeUndefined();

    const originalEnv = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      expect(getDatabaseUrl()).toBeUndefined();
    } finally {
      process.env.DATABASE_URL = originalEnv;
    }
  });

  it("returns non-pooler URLs unchanged", () => {
    const local = "postgresql://postgres:postgres@localhost:5432/qwik_dev";
    expect(getDatabaseUrl(local)).toBe(local);

    const standardPg = "postgresql://user:pass@dpg-abc-a.oregon-postgres.render.com/qwik";
    expect(getDatabaseUrl(standardPg)).toBe(standardPg);
  });

  it("configures pgbouncer, connection_limit, and pool_timeout for Supabase pooler", () => {
    const supabasePooler = "postgresql://postgres.project:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";
    const result = getDatabaseUrl(supabasePooler);

    expect(result).toBeDefined();
    const parsed = new URL(result!);
    expect(parsed.searchParams.get("pgbouncer")).toBe("true");
    expect(parsed.searchParams.get("connection_limit")).toBe("5");
    expect(parsed.searchParams.get("pool_timeout")).toBe("20");
  });

  it("preserves higher connection_limit and pool_timeout if explicitly set", () => {
    const supabasePooler =
      "postgresql://postgres.project:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?connection_limit=15&pool_timeout=45";
    const result = getDatabaseUrl(supabasePooler);

    expect(result).toBeDefined();
    const parsed = new URL(result!);
    expect(parsed.searchParams.get("pgbouncer")).toBe("true");
    expect(parsed.searchParams.get("connection_limit")).toBe("15");
    expect(parsed.searchParams.get("pool_timeout")).toBe("45");
  });

  it("bumps lower connection_limit and pool_timeout to minimum safe thresholds", () => {
    const supabasePooler =
      "postgresql://postgres.project:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?connection_limit=2&pool_timeout=5";
    const result = getDatabaseUrl(supabasePooler);

    expect(result).toBeDefined();
    const parsed = new URL(result!);
    expect(parsed.searchParams.get("connection_limit")).toBe("5");
    expect(parsed.searchParams.get("pool_timeout")).toBe("20");
  });
});
