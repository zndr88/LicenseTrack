import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MappingStep from "../components/csv-import/MappingStep.jsx";

function renderStep({ canCreateCustomFields = false, matchedInternalFields = new Set() } = {}) {
  return render(
    <MappingStep
      analyzeData={{ missingRequired: [] }}
      error={null}
      showMatched={false}
      setShowMatched={vi.fn()}
      activeMatchedColumns={[]}
      allUnrecognizedColumns={[{ rawHeader: "Owner", sampleValues: ["Alice"] }]}
      matchedInternalFields={matchedInternalFields}
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
    expect(screen.getByRole("option", { name: "Procurement Reference" })).toHaveValue("procurement_reference");
    expect(screen.getByRole("option", { name: "Parent LT Ref" })).toHaveValue("parent_license_ref");
    expect(screen.queryByRole("button", { name: "Create custom field" })).not.toBeInTheDocument();
  });

  it("offers explicit custom-field creation to admins", () => {
    renderStep({ canCreateCustomFields: true });

    expect(screen.getByRole("button", { name: "Create custom field" })).toBeInTheDocument();
  });

  it("keeps secondary contacts available for multiple mapped columns", () => {
    renderStep({ matchedInternalFields: new Set(["secondary_contacts", "budget_owner_email"]) });

    expect(screen.getByRole("option", { name: "Secondary Contacts" })).toHaveValue("secondary_contacts");
    expect(screen.queryByRole("option", { name: "Budget Owner Email" })).not.toBeInTheDocument();
  });
});
