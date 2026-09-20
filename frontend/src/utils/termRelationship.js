// Shared date-continuity check between two terms in a succession chain.
// `earlier` is the predecessor term, `later` the successor term. Returns a
// tone + human label describing whether the terms are contiguous, or how much
// they gap/overlap, or null when either date is missing.
export function termDateRelationship(earlier, later) {
  if (!earlier?.endDate || !later?.startDate) return null;
  const earlierEnd = new Date(`${earlier.endDate}T00:00:00`);
  const laterStart = new Date(`${later.startDate}T00:00:00`);
  if (Number.isNaN(earlierEnd.getTime()) || Number.isNaN(laterStart.getTime())) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const delta = Math.round((laterStart - earlierEnd) / dayMs) - 1;
  if (delta > 0) return { tone: "warning", text: `${delta}-day gap between terms` };
  if (delta < 0) return { tone: "warning", text: `${Math.abs(delta)}-day overlap between terms` };
  return { tone: "ok", text: "Terms are contiguous" };
}
