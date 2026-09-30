const PARTS = [
  ["renewalInProgress", "renewal in progress"],
  ["retiring", "retiring"],
  ["notStarted", "not started"],
];

/** "12 expiring · 5 renewal in progress · 6 not started"; zero parts omitted. */
export function expiryBreakdownText(stageLabel, total, breakdown) {
  if (!breakdown || !total) return null;
  const parts = PARTS
    .filter(([key]) => breakdown[key] > 0)
    .map(([key, label]) => `${breakdown[key]} ${label}`);
  return [`${total} ${stageLabel}`, ...parts].join(" · ");
}
