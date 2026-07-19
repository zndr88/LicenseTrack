import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MappingStep from "../components/csv-import/MappingStep.jsx";

function renderStep({ canCreateCustomFields = false } = {}) {
  return render(
    <MappingStep
      analyzeData={{ missingRequired: [] }}
      error={null}
      showMatched={false}
      setShowMatched={vi.fn()}
      activeMatchedColumns={[]}
      allUnrecognizedColumns={[{ rawHeader: "Owner", sampleValues: ["Alice"] }]}
      matchedInternalFields={new Set()}
      columnDecisions={{
        Owner: { action: "map", targetField: "", cfName: "Owner", cfType: "text", cfKey: null },
      }}
      customFieldDefs={[{ id: 9, name: "Contract Owner", fieldKey: "cf_contract_owner" }]}
      allResolved={false}
      updateDecision={vi.fn()}
      handleUnmatch={vi.fn()}
      handleCreateField={vi.fn()}
      creatingFields={false}
      loading={false}
      mappingName=""
      setMappingName={vi.fn()}
      canManageImportMappings={canCreateCustomFields}
      canCreateCustomFields={canCreateCustomFields}
      handleMappedPreview={vi.fn()}
      reset={vi.fn()}
    />
  );
}

describe("MappingStep custom fields", () => {
  it("offers existing custom fields to editors without offering definition creation", () => {
    renderStep();

    expect(screen.getByRole("option", { name: "Contract Owner" })).toHaveValue("cf_contract_owner");
    expect(screen.queryByRole("button", { name: "Create custom field" })).not.toBeInTheDocument();
  });

  it("offers explicit custom-field creation to admins", () => {
    renderStep({ canCreateCustomFields: true });

    expect(screen.getByRole("button", { name: "Create custom field" })).toBeInTheDocument();
  });
});
