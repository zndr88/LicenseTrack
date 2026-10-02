import { canFollowInTermChain } from "./licenseTypeRules.js";

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

// True when following next-term links from `start` reaches `targetId`.
function leadsTo(start, targetId, items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set();
  let current = start;
  while (current && !seen.has(current.id)) {
    if (current.id === targetId) return true;
    seen.add(current.id);
    current = current.successorSourcingItemId != null ? byId.get(current.successorSourcingItemId) : null;
  }
  return false;
}

// Why `predecessor` can't roll into `successor` within one request, as a code,
// or null when it can. The one rule behind both term dialogs (Set predecessors
// and Set next term); the server checks the same in planned_successor_service.py.
export function termLinkBlock(predecessor, successor, items = []) {
  if (predecessor.id === successor.id) return "self";
  if (!canFollowInTermChain(predecessor, successor)) return "type";
  if (successor.renewalForLicenseId != null || successor.cotermPredecessorIds?.length) return "follows_license";
  if (predecessor.successorSourcingItemId != null && predecessor.successorSourcingItemId !== successor.id) return "linked";
  if (leadsTo(successor, predecessor.id, items)) return "loop";
  if (predecessor.startDate && successor.startDate && predecessor.startDate >= successor.startDate) return "order";
  return null;
}

// What each dialog says about a candidate it can't offer. In Set predecessors
// the candidate is the earlier line; in Set next term it is the later line.
export const TERM_LINK_REASONS = {
  asPredecessor: {
    type: "Maintenance terms can only follow maintenance terms",
    linked: "Already linked to another next term",
    loop: "Already comes after this line",
    order: "Starts on or after this line",
  },
  asSuccessor: {
    type: "Maintenance terms can only follow maintenance terms",
    follows_license: "Already follows an existing license",
    loop: "Already comes before this line",
    order: "Starts on or before this line",
  },
};
