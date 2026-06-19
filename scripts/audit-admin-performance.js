#!/usr/bin/env node
/**
 * Admin endpoint performance audit script
 * Measures baseline and caching performance improvements
 */

const http = require("http");

const BASE_URL = "http://localhost:3001";
const API_ENDPOINTS = [
  { name: "GET /api/admin/stats", method: "GET", path: "/api/admin/stats" },
  { name: "GET /api/admin/users", method: "GET", path: "/api/admin/users?page=1&pageSize=50" },
  { name: "GET /api/admin/ads", method: "GET", path: "/api/admin/ads?page=1&pageSize=50" },
  { name: "GET /api/admin/reports", method: "GET", path: "/api/admin/reports?page=1&pageSize=50" },
  { name: "GET /api/admin/reviews", method: "GET", path: "/api/admin/reviews?page=1&pageSize=50" },
  { name: "GET /api/admin/verifications", method: "GET", path: "/api/admin/verifications?page=1&pageSize=50" },
  { name: "GET /api/admin/audit-log", method: "GET", path: "/api/admin/audit-log?page=1&pageSize=50" },
];

// Test admin token (from localStorage or .env)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "test-token";

/**
 * Make HTTP request and measure response time
 */
async function makeRequest(method, path) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const url = new URL(BASE_URL + path);

    const options = {
      hostname: url.hostname,
      port: url.port || 3001,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        const duration = Date.now() - startTime;
        const isCached = res.headers._cached === "true" || data.includes('"_cached":true');
        resolve({
          statusCode: res.statusCode,
          duration,
          isCached,
          size: data.length,
          headers: res.headers,
        });
      });
    });

    req.on("error", reject);
    req.end();
  });
}

/**
 * Run performance audit
 */
async function runAudit() {
  console.log("\n=== ADMIN API PERFORMANCE AUDIT ===\n");
  console.log("Starting performance measurements...\n");

  const results = [];

  for (const endpoint of API_ENDPOINTS) {
    console.log(`Testing: ${endpoint.name}`);
    const coldResults = [];
    const warmResults = [];

    try {
      // Cold request (no cache)
      const cold1 = await makeRequest(endpoint.method, endpoint.path);
      coldResults.push(cold1.duration);

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Warm request (cache hit)
      const warm1 = await makeRequest(endpoint.method, endpoint.path);
      warmResults.push(warm1.duration);

      // Another warm request
      const warm2 = await makeRequest(endpoint.method, endpoint.path);
      warmResults.push(warm2.duration);

      const avgCold = Math.round(coldResults.reduce((a, b) => a + b, 0) / coldResults.length);
      const avgWarm = Math.round(warmResults.reduce((a, b) => a + b, 0) / warmResults.length);
      const improvement = Math.round((1 - avgWarm / avgCold) * 100);

      results.push({
        endpoint: endpoint.name,
        coldTime: avgCold,
        warmTime: avgWarm,
        improvement,
        cached: warm1.isCached || warm2.isCached,
      });

      console.log(`  Cold: ${avgCold}ms | Warm: ${avgWarm}ms | Improvement: ${improvement}% | Cached: ${warm1.isCached || warm2.isCached}`);
    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
      results.push({
        endpoint: endpoint.name,
        error: error.message,
      });
    }
  }

  // Summary table
  console.log("\n=== RESULTS SUMMARY ===\n");
  console.table(results);

  // Calculate aggregate stats
  const successResults = results.filter((r) => !r.error);
  if (successResults.length > 0) {
    const avgColdAll = Math.round(
      successResults.reduce((a, b) => a + (b.coldTime || 0), 0) / successResults.length
    );
    const avgWarmAll = Math.round(
      successResults.reduce((a, b) => a + (b.warmTime || 0), 0) / successResults.length
    );
    const avgImprovementAll = Math.round(
      successResults.reduce((a, b) => a + (b.improvement || 0), 0) / successResults.length
    );

    console.log("\n=== AGGREGATE METRICS ===");
    console.log(`Average Cold Time: ${avgColdAll}ms`);
    console.log(`Average Warm Time: ${avgWarmAll}ms`);
    console.log(`Average Improvement: ${avgImprovementAll}%`);
    console.log(`Cached Endpoints: ${successResults.filter((r) => r.cached).length}/${successResults.length}`);
  }

  console.log("\n");
}

// Run audit
runAudit().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});
