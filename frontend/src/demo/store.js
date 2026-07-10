import { buildSeedData } from "./fixtures.js";

/** Module-level in-memory state. Refresh or logout wipes it — that IS the reset story. */
export const store = {
  licenses: [],
  sourcingItems: [],
  sourcingRequests: [],
  pendingOrders: [],
  seeded: false,
  _nextId: 1000,
};

export function nextId() {
  return store._nextId++;
}

export function resetStore() {
  store.licenses = [];
  store.sourcingItems = [];
  store.sourcingRequests = [];
  store.pendingOrders = [];
  store.seeded = false;
  store._nextId = 1000;
}

export function seedStore() {
  const seed = buildSeedData();
  store.licenses = seed.licenses;
  store.sourcingItems = seed.sourcingItems;
  store.sourcingRequests = seed.sourcingRequests;
  store.pendingOrders = seed.pendingOrders;
  store.seeded = true;
}
