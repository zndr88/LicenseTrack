import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useStagedDocumentAttachments } from "../components/procurement/useStagedDocumentAttachments.js";

describe("useStagedDocumentAttachments", () => {
  test("uses category defaults and supports changing each document scope", () => {
    const { result } = renderHook(() => useStagedDocumentAttachments("line-1"));
    const invoice = new File(["invoice"], "invoice.pdf", { type: "application/pdf" });
    const eula = new File(["terms"], "eula.pdf", { type: "application/pdf" });

    act(() => {
      result.current.addFiles("invoice", [invoice]);
      result.current.addFiles("eula", [eula]);
    });

    expect(result.current.attachments).toEqual([
      expect.objectContaining({ category: "invoice", scope: "shared" }),
      expect.objectContaining({ category: "eula", scope: "license", targetKey: "line-1" }),
    ]);

    act(() => {
      result.current.changeCategoryScope("invoice", "license");
      result.current.changeCategoryScope("eula", "shared");
    });

    expect(result.current.categoryScopes).toEqual(expect.objectContaining({
      invoice: "license",
      eula: "shared",
    }));
    expect(result.current.attachments[0]).toEqual(expect.objectContaining({
      scope: "license",
      targetKey: "line-1",
    }));
    expect(result.current.attachments[1]).not.toHaveProperty("targetKey");
    expect(result.current.attachments[1].scope).toBe("shared");

    const anotherEula = new File(["terms 2"], "eula-2.pdf", { type: "application/pdf" });
    act(() => result.current.addFiles("eula", [anotherEula]));
    expect(result.current.attachments[2]).toEqual(expect.objectContaining({
      category: "eula",
      scope: "shared",
    }));
  });
});
