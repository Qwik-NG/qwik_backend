"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
function getDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl)
        return undefined;
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
    }
    catch {
        return databaseUrl;
    }
}
exports.prisma = new client_1.PrismaClient({
    datasources: {
        db: {
            url: getDatabaseUrl(),
        },
    },
});
