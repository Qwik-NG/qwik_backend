import { prisma } from "./prisma";
import { queueAdPerformanceReportEmail } from "./engagementOutbox";
import { env } from "../config/env";
import { buildBrandedEmailHtml } from "./emailBranding";

type EnqueueAdPerformanceReportsInput = {
  periodStart?: Date;
  periodEnd?: Date;
  sellerIds?: string[];
};

export type EnqueueAdPerformanceReportsSummary = {
  periodStart: string;
  periodEnd: string;
  sellersScanned: number;
  jobsCreated: number;
  duplicatesSkipped: number;
  skippedNoEmail: number;
};

type ListingMetricRow = {
  id: string;
  title: string;
  status: string;
  isPromoted: boolean;
  saves: number;
  conversations: number;
  messages: number;
  reviews: number;
  reports: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function frontendBaseUrl() {
  const primaryOrigin = env.frontendUrl.split(",")[0]?.trim().replace(/\/$/, "");
  if (!primaryOrigin || !/^https?:\/\//.test(primaryOrigin)) return "";
  return primaryOrigin;
}

function absoluteUrl(path: string) {
  const base = frontendBaseUrl();
  if (!base) return path;
  if (path.startsWith("/")) return `${base}${path}`;
  return `${base}/${path}`;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function previousWeekPeriod(now = new Date()) {
  const today = startOfUtcDay(now);
  const weekday = today.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const currentWeekStart = new Date(today.getTime() - daysSinceMonday * MS_PER_DAY);
  const periodStart = new Date(currentWeekStart.getTime() - 7 * MS_PER_DAY);
  const periodEnd = currentWeekStart;
  return { periodStart, periodEnd };
}

function periodLabel(periodStart: Date, periodEndExclusive: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const periodEndInclusive = new Date(periodEndExclusive.getTime() - 1);
  return `${formatter.format(periodStart)} - ${formatter.format(periodEndInclusive)}`;
}

function listingScore(row: ListingMetricRow) {
  return row.saves + row.conversations * 3 + row.messages * 2 + row.reviews - row.reports;
}

function buildEmailBodies(input: {
  sellerName: string;
  periodStart: Date;
  periodEnd: Date;
  totals: {
    listingsTotal: number;
    active: number;
    sold: number;
    draft: number;
    archived: number;
    promoted: number;
    saves: number;
    conversations: number;
    messages: number;
    reviews: number;
    reports: number;
  };
  topListings: ListingMetricRow[];
  needsAttention: ListingMetricRow[];
}) {
  const label = periodLabel(input.periodStart, input.periodEnd);
  const sellerName = escapeHtml(input.sellerName || "Seller");
  const dashboardUrl = absoluteUrl("/profile");
  const messagesUrl = absoluteUrl("/messages");

  const topRows = input.topListings.length > 0
    ? input.topListings.map((listing, index) => {
        const listingTitle = escapeHtml(listing.title || "Untitled listing");
        return `<li>#${index + 1} ${listingTitle} - saves ${listing.saves}, conversations ${listing.conversations}, messages ${listing.messages}, reviews ${listing.reviews}, reports ${listing.reports}</li>`;
      }).join("")
    : "<li>No listing activity for this period.</li>";

  const attentionRows = input.needsAttention.length > 0
    ? input.needsAttention.map((listing) => `<li>${escapeHtml(listing.title || "Untitled listing")}</li>`).join("")
    : "<li>None. Great job keeping your listings active.</li>";

  const reportContentHtml = `<p>Hi ${sellerName},</p>
<p>Here is your Qwik weekly ad performance summary for <strong>${label}</strong>.</p>
<p><strong>Listings:</strong> total ${input.totals.listingsTotal}, active ${input.totals.active}, sold ${input.totals.sold}, draft ${input.totals.draft}, archived ${input.totals.archived}, promoted ${input.totals.promoted}</p>
<p><strong>Activity:</strong> saves ${input.totals.saves}, conversations ${input.totals.conversations}, messages ${input.totals.messages}, reviews ${input.totals.reviews}, reports ${input.totals.reports}</p>
<p><strong>Top performing listings</strong></p>
<ul>${topRows}</ul>
<p><strong>Listings needing attention</strong></p>
<ul>${attentionRows}</ul>
<p><a href="${dashboardUrl}">Open your listings dashboard</a></p>
<p><a href="${messagesUrl}">Open your messages</a></p>
<p>You can manage your notification preferences in your account settings.</p>`;
  const htmlBody = buildBrandedEmailHtml(reportContentHtml, "Your weekly Qwik ad performance summary");

  const topRowsText = input.topListings.length > 0
    ? input.topListings.map((listing, index) =>
      `${index + 1}. ${listing.title || "Untitled listing"} (saves ${listing.saves}, conversations ${listing.conversations}, messages ${listing.messages}, reviews ${listing.reviews}, reports ${listing.reports})`).join("\n")
    : "- No listing activity for this period.";

  const attentionRowsText = input.needsAttention.length > 0
    ? input.needsAttention.map((listing) => `- ${listing.title || "Untitled listing"}`).join("\n")
    : "- None. Great job keeping your listings active.";

  const textBody = [
    `Hi ${input.sellerName || "Seller"},`,
    "",
    `Here is your Qwik weekly ad performance summary for ${label}.`,
    "",
    `Listings: total ${input.totals.listingsTotal}, active ${input.totals.active}, sold ${input.totals.sold}, draft ${input.totals.draft}, archived ${input.totals.archived}, promoted ${input.totals.promoted}`,
    `Activity: saves ${input.totals.saves}, conversations ${input.totals.conversations}, messages ${input.totals.messages}, reviews ${input.totals.reviews}, reports ${input.totals.reports}`,
    "",
    "Top performing listings:",
    topRowsText,
    "",
    "Listings needing attention:",
    attentionRowsText,
    "",
    `Open listings dashboard: ${dashboardUrl}`,
    `Open messages: ${messagesUrl}`,
    "",
    "You can manage your notification preferences in your account settings.",
  ].join("\n");

  return {
    subject: `Your Qwik weekly ad performance summary (${label})`,
    htmlBody,
    textBody,
    actionUrl: "/profile",
  };
}

export async function enqueueAdPerformanceReports(
  input: EnqueueAdPerformanceReportsInput = {},
): Promise<EnqueueAdPerformanceReportsSummary> {
  const resolvedPeriod = input.periodStart && input.periodEnd
    ? { periodStart: input.periodStart, periodEnd: input.periodEnd }
    : previousWeekPeriod();

  const periodStartIso = resolvedPeriod.periodStart.toISOString();
  const periodEndIso = resolvedPeriod.periodEnd.toISOString();
  const now = new Date();

  const sellers = await prisma.user.findMany({
    where: {
      ...(input.sellerIds && input.sellerIds.length > 0 ? { id: { in: input.sellerIds } } : {}),
      ads: { some: {} },
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      ads: {
        select: {
          id: true,
          title: true,
          status: true,
          isPromoted: true,
          promotedUntil: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  let jobsCreated = 0;
  let duplicatesSkipped = 0;
  let skippedNoEmail = 0;

  for (const seller of sellers) {
    if (!seller.email) {
      skippedNoEmail += 1;
      continue;
    }

    const adIds = seller.ads.map((ad) => ad.id);
    if (adIds.length === 0) continue;

    const [savesByAd, reviewByAd, reportByAd, conversationRows] = await Promise.all([
      prisma.savedAd.groupBy({
        by: ["adId"],
        where: {
          adId: { in: adIds },
          createdAt: { gte: resolvedPeriod.periodStart, lt: resolvedPeriod.periodEnd },
        },
        _count: { _all: true },
      }),
      prisma.review.groupBy({
        by: ["adId"],
        where: {
          adId: { in: adIds },
          createdAt: { gte: resolvedPeriod.periodStart, lt: resolvedPeriod.periodEnd },
        },
        _count: { _all: true },
      }),
      prisma.report.groupBy({
        by: ["adId"],
        where: {
          adId: { in: adIds },
          createdAt: { gte: resolvedPeriod.periodStart, lt: resolvedPeriod.periodEnd },
        },
        _count: { _all: true },
      }),
      prisma.conversation.findMany({
        where: {
          adId: { in: adIds },
          createdAt: { gte: resolvedPeriod.periodStart, lt: resolvedPeriod.periodEnd },
        },
        select: {
          id: true,
          adId: true,
        },
      }),
    ]);

    const conversationIds = conversationRows.map((row) => row.id);
    const messagesByConversation = conversationIds.length > 0
      ? await prisma.message.groupBy({
          by: ["conversationId"],
          where: {
            conversationId: { in: conversationIds },
            createdAt: { gte: resolvedPeriod.periodStart, lt: resolvedPeriod.periodEnd },
          },
          _count: { _all: true },
        })
      : [];

    const savesByAdMap = new Map(savesByAd.map((row) => [row.adId, row._count._all]));
    const reviewsByAdMap = new Map(reviewByAd.map((row) => [row.adId, row._count._all]));
    const reportsByAdMap = new Map(reportByAd.map((row) => [row.adId, row._count._all]));

    const conversationsByAdMap = new Map<string, number>();
    const adIdByConversationId = new Map<string, string>();

    for (const conversation of conversationRows) {
      if (!conversation.adId) continue;
      adIdByConversationId.set(conversation.id, conversation.adId);
      conversationsByAdMap.set(conversation.adId, (conversationsByAdMap.get(conversation.adId) ?? 0) + 1);
    }

    const messagesByAdMap = new Map<string, number>();
    for (const messageRow of messagesByConversation) {
      const adId = adIdByConversationId.get(messageRow.conversationId);
      if (!adId) continue;
      messagesByAdMap.set(adId, (messagesByAdMap.get(adId) ?? 0) + messageRow._count._all);
    }

    const listingMetrics: ListingMetricRow[] = seller.ads.map((ad) => ({
      id: ad.id,
      title: ad.title,
      status: ad.status,
      isPromoted: ad.isPromoted && (!ad.promotedUntil || ad.promotedUntil > now),
      saves: savesByAdMap.get(ad.id) ?? 0,
      conversations: conversationsByAdMap.get(ad.id) ?? 0,
      messages: messagesByAdMap.get(ad.id) ?? 0,
      reviews: reviewsByAdMap.get(ad.id) ?? 0,
      reports: reportsByAdMap.get(ad.id) ?? 0,
    }));

    const totals = listingMetrics.reduce(
      (acc, row) => {
        acc.saves += row.saves;
        acc.conversations += row.conversations;
        acc.messages += row.messages;
        acc.reviews += row.reviews;
        acc.reports += row.reports;
        if (row.status === "ACTIVE") acc.active += 1;
        if (row.status === "SOLD") acc.sold += 1;
        if (row.status === "DRAFT") acc.draft += 1;
        if (row.status === "ARCHIVED") acc.archived += 1;
        if (row.isPromoted) acc.promoted += 1;
        return acc;
      },
      {
        listingsTotal: listingMetrics.length,
        active: 0,
        sold: 0,
        draft: 0,
        archived: 0,
        promoted: 0,
        saves: 0,
        conversations: 0,
        messages: 0,
        reviews: 0,
        reports: 0,
      },
    );

    const topListings = [...listingMetrics].sort((a, b) => listingScore(b) - listingScore(a)).slice(0, 3);
    const needsAttention = listingMetrics
      .filter((row) => row.status === "ACTIVE" && row.saves + row.conversations + row.messages + row.reviews === 0)
      .slice(0, 3);

    const template = buildEmailBodies({
      sellerName: seller.fullName,
      periodStart: resolvedPeriod.periodStart,
      periodEnd: resolvedPeriod.periodEnd,
      totals,
      topListings,
      needsAttention,
    });

    const idempotencyKey = `${seller.id}:${periodStartIso}:${periodEndIso}`;

    const { duplicate } = await queueAdPerformanceReportEmail({
      recipientId: seller.id,
      recipientEmail: seller.email,
      idempotencyKey,
      subject: template.subject,
      htmlBody: template.htmlBody,
      textBody: template.textBody,
      actionUrl: template.actionUrl,
      payload: {
        kind: "ad-performance-report",
        sellerId: seller.id,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
        totals,
      },
    });

    if (duplicate) {
      duplicatesSkipped += 1;
    } else {
      jobsCreated += 1;
    }
  }

  return {
    periodStart: periodStartIso,
    periodEnd: periodEndIso,
    sellersScanned: sellers.length,
    jobsCreated,
    duplicatesSkipped,
    skippedNoEmail,
  };
}