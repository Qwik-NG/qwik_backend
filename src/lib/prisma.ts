import { PrismaClient } from "@prisma/client";

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return undefined;

  try {
    const url = new URL(databaseUrl);
    if (url.hostname.includes("pooler.supabase.com")) {
      url.searchParams.set("pgbouncer", "true");
      const connectionLimit = Number(url.searchParams.get("connection_limit"));
      if (!connectionLimit || connectionLimit < 5) {
        url.searchParams.set("connection_limit", "5");
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
