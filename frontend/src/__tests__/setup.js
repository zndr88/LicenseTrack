import '@testing-library/jest-dom'

// Tests preview uploaded files through URL.createObjectURL. The jsdom and
// vitest versions disagree on how that is shimmed (jsdom >= 30.1 breaks the
// vitest shim), so tests provide their own deterministic blob URLs.
let blobUrlCounter = 0
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: () => `blob:vitest/${++blobUrlCounter}`,
})
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: () => {},
})
