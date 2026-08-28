const WAT_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 year-round, no DST

export function getPreviousWatMonthPeriod(reference: Date = new Date()) {
  const watNow = new Date(reference.getTime() + WAT_OFFSET_MS);
  const watYear = watNow.getUTCFullYear();
  const watMonth = watNow.getUTCMonth();

  const periodStart = new Date(Date.UTC(watYear, watMonth - 1, 1, 0, 0, 0) - WAT_OFFSET_MS);
  const periodEnd = new Date(Date.UTC(watYear, watMonth, 1, 0, 0, 0) - WAT_OFFSET_MS);

  return { periodStart, periodEnd };
}
