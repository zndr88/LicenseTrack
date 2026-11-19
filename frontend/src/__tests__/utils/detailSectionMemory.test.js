import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOpenSections, saveOpenSections } from "../../utils/detailSectionMemory.js";

const defaults = { identity: true, dates: false, commercial: false };

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detailSectionMemory", () => {
  it("returns the defaults when nothing was remembered", () => {
    expect(loadOpenSections(7, defaults)).toEqual(defaults);
  });

  it("returns what was saved for that user", () => {
    saveOpenSections(7, { identity: false, dates: true, commercial: false });

    expect(loadOpenSections(7, defaults)).toEqual({ identity: false, dates: true, commercial: false });
  });

  it("keeps each user's sections apart", () => {
    saveOpenSections(7, { identity: true, dates: true, commercial: true });

    expect(loadOpenSections(8, defaults)).toEqual(defaults);
  });

  it("ignores unknown sections and values that are not true or false", () => {
    window.localStorage.setItem(
      "licensetrack.detailSections.7",
      JSON.stringify({ dates: "yes", commercial: true, removedSection: true }),
    );

    expect(loadOpenSections(7, defaults)).toEqual({ identity: true, dates: false, commercial: true });
  });

  it("falls back to the defaults when the stored text is unreadable", () => {
    window.localStorage.setItem("licensetrack.detailSections.7", "{not json");

    expect(loadOpenSections(7, defaults)).toEqual(defaults);
  });

  it("does not remember anything without a signed-in user", () => {
    saveOpenSections(undefined, { identity: true, dates: true, commercial: false });

    expect(window.localStorage.length).toBe(0);
    expect(loadOpenSections(undefined, defaults)).toEqual(defaults);
  });

  it("carries on when the browser refuses storage", () => {
    vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });

    expect(() => saveOpenSections(7, defaults)).not.toThrow();
    expect(loadOpenSections(7, defaults)).toEqual(defaults);
  });
});
