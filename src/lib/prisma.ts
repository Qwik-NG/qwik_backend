import { PrismaClient } from "@prisma/client";

export function getDatabaseUrl(rawUrl?: string) {
  const databaseUrl = rawUrl !== undefined ? rawUrl : process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;

  try {
    const url = new URL(databaseUrl);
    if (url.hostname.includes("pooler.supabase.com")) {
      url.searchParams.set("pgbouncer", "true");
      const connectionLimit = Number(url.searchParams.get("connection_limit"));
      if (!connectionLimit || connectionLimit < 5) {
        url.searchParams.set("connection_limit", "5");
      }
      const poolTimeout = Number(url.searchParams.get("pool_timeout"));
      if (!poolTimeout || poolTimeout < 20) {
        url.searchParams.set("pool_timeout", "20");
      }
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
});
