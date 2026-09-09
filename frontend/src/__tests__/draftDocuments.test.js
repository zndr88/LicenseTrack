import { describe, expect, it, vi } from "vitest";
import { draftDocumentTargetMap, uploadDraftDocuments } from "../utils/draftDocuments.js";

describe("draft document uploads", () => {
  it("maps stable form keys to saved line IDs and leaves shared files untargeted", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const shared = new File(["quote"], "quote.pdf");
    const single = new File(["key"], "key.txt");
    const result = await uploadDraftDocuments({
      parentId: 5,
      attachments: [
        { file: shared, category: "quote", scope: "shared" },
        { file: single, category: "entitlement", scope: "license", targetKey: "second" },
      ],
      targetIdsByKey: draftDocumentTargetMap(["primary", "second"], [{ id: 12 }, { id: 18 }]),
      upload,
    });
    expect(result.errors).toEqual([]);
    expect(upload).toHaveBeenNthCalledWith(1, 5, shared, { category: "quote", scope: "shared" });
    expect(upload).toHaveBeenNthCalledWith(2, 5, single, { category: "entitlement", scope: "license", targetSourcingItemId: 18 });
  });

  it("reports removed targets and upload failures without stopping later uploads", async () => {
    const upload = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValue({ error: null });
    const result = await uploadDraftDocuments({
      parentId: 5,
      attachments: [
        { file: new File([], "removed.txt"), scope: "license", targetKey: "removed" },
        { file: new File([], "failed.pdf"), category: "quote", scope: "shared" },
        { file: new File([], "saved.pdf"), category: "invoice", scope: "shared" },
      ],
      upload,
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(result.errors).toEqual([
      "removed.txt: the selected line item is no longer available",
      "failed.pdf: Disk full",
    ]);
  });
});
