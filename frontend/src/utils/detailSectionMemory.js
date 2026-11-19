// Remembers which License Details sections a user keeps open, in this browser.
// The demo build writes nothing to browser storage, so it remembers only until
// the page is reloaded.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const demoMemory = new Map();

const storageKey = (userId) => `licensetrack.detailSections.${userId}`;

function readStored(userId) {
  if (DEMO_MODE) return demoMemory.get(userId) ?? null;
  try {
    return JSON.parse(window.localStorage.getItem(storageKey(userId)));
  } catch {
    return null;
  }
}

/** The sections to show open: `defaults`, overridden by what this user left open or closed. */
export function loadOpenSections(userId, defaults) {
  if (userId == null) return defaults;
  const stored = readStored(userId);
  if (!stored || typeof stored !== "object") return defaults;
  const sections = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof stored[key] === "boolean") sections[key] = stored[key];
  }
  return sections;
}

/** Remember the open sections for this user. A browser that refuses storage is ignored. */
export function saveOpenSections(userId, sections) {
  if (userId == null) return;
  if (DEMO_MODE) {
    demoMemory.set(userId, { ...sections });
    return;
  }
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(sections));
  } catch {
    // Private browsing or a full store: the panel simply opens with the defaults next time.
  }
}
