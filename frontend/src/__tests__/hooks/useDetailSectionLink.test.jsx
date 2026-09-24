import { useState } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDetailSectionLink } from "../../hooks/useDetailSectionLink.js";

let api;

function Harness({ license, enabled = true }) {
  const [openSections, setOpenSections] = useState({ identity: true, documents: false, notes: false });
  const updateSectionLink = useDetailSectionLink({ license, setOpenSections, enabled });
  const toggle = (key) => {
    updateSectionLink(key, !openSections[key]);
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  api = { openSections, toggle };
  return null;
}

const license20 = { id: 20, licenseRef: "LT-2026-00020" };

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useDetailSectionLink", () => {
  it("opens the section named in the URL hash", async () => {
    window.history.replaceState(null, "", "/licenses/20#documents");
    render(<Harness license={license20} />);

    await waitFor(() => expect(api.openSections.documents).toBe(true));
  });

  it("opens the section when the path uses the LT Ref", async () => {
    window.history.replaceState(null, "", "/licenses/LT-2026-00020#notes");
    render(<Harness license={license20} />);

    await waitFor(() => expect(api.openSections.notes).toBe(true));
  });

  it("ignores a hash that belongs to another license's address", () => {
    window.history.replaceState(null, "", "/licenses/21#documents");
    render(<Harness license={license20} />);

    expect(api.openSections.documents).toBe(false);
  });

  it("writes the hash when a section opens and removes it when that section closes", () => {
    window.history.replaceState(null, "", "/licenses/20");
    render(<Harness license={license20} />);
    const historyLength = window.history.length;

    act(() => api.toggle("documents"));
    expect(window.location.hash).toBe("#documents");

    act(() => api.toggle("notes"));
    expect(window.location.hash).toBe("#notes");

    act(() => api.toggle("documents"));
    expect(window.location.hash).toBe("#notes");

    act(() => api.toggle("notes"));
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/licenses/20");
    // Section toggles replace the history entry instead of adding Back steps.
    expect(window.history.length).toBe(historyLength);
  });

  it("opens the section when the hash changes in the address bar", async () => {
    window.history.replaceState(null, "", "/licenses/20");
    render(<Harness license={license20} />);

    act(() => {
      window.history.replaceState(null, "", "/licenses/20#documents");
      window.dispatchEvent(new window.HashChangeEvent("hashchange"));
    });

    await waitFor(() => expect(api.openSections.documents).toBe(true));
  });

  it("leaves the URL alone when links are disabled (demo build)", () => {
    window.history.replaceState(null, "", "/licenses/20#documents");
    render(<Harness license={license20} enabled={false} />);

    expect(api.openSections.documents).toBe(false);
    act(() => api.toggle("notes"));
    expect(window.location.hash).toBe("#documents");
  });
});
