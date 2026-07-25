import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ContractModal from "../../components/contracts/ContractModal.jsx";
import * as contractsApi from "../../api/contracts.js";

vi.mock("../../api/contracts.js", () => ({
  getContract: vi.fn(),
  getContractLicenses: vi.fn(),
  updateContract: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  getContractDocuments: vi.fn(),
  uploadContractDocument: vi.fn(),
  downloadContractDocument: vi.fn(),
  deleteContractDocument: vi.fn(),
}));

vi.mock("../../components/ui/Icon.jsx", () => ({
  default: ({ name }) => <span>{name}</span>,
}));

const admin = { id: 1, role: "admin", username: "admin" };

const baseContract = {
  id: 10,
  publisherName: "Acme Corp",
  contractNumber: "CN-100",
  notes: "Renewal baseline",
  folders: [
    { id: 7, name: "Invoices" },
  ],
};

const baseDocs = [
  { id: 21, originalFilename: "general.pdf", folderId: null },
  { id: 22, originalFilename: "invoice.pdf", folderId: 7 },
];

function mockLoadedContract(overrides = {}) {
  contractsApi.getContract.mockResolvedValue({ data: { ...baseContract, ...overrides.contract }, error: null });
  contractsApi.getContractLicenses.mockResolvedValue({ data: overrides.licenses ?? [], error: null });
  contractsApi.getContractDocuments.mockResolvedValue({ data: overrides.documents ?? baseDocs, error: null });
}

function renderModal(props = {}) {
  const onClose = vi.fn();
  const onNavigateToLicense = vi.fn();
  render(
    <ContractModal
      contractId={10}
      onClose={onClose}
      onNavigateToLicense={onNavigateToLicense}
      user={admin}
      {...props}
    />
  );
  return { onClose, onNavigateToLicense };
}

async function renderLoadedModal(props = {}, mockOverrides = {}) {
  mockLoadedContract(mockOverrides);
  const result = renderModal(props);
  expect(screen.getByRole("dialog", { name: /loading/i })).toBeInTheDocument();
  expect(await screen.findByRole("dialog", { name: /acme corp/i })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /toggle invoices folder/i })).toBeInTheDocument();
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("ContractModal", () => {
  test("renders loading state, then view header with contract publisher and number", async () => {
    await renderLoadedModal();

    expect(screen.getByRole("heading", { name: "Acme Corp" })).toBeInTheDocument();
    expect(screen.getByText("CN-100")).toBeInTheDocument();
  });

  test("view-mode Escape calls onClose", async () => {
    const { onClose } = await renderLoadedModal();

    fireEvent.keyDown(screen.getByRole("dialog", { name: /acme corp/i }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("view-mode close button calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("overlay click does not close", async () => {
    const { onClose } = await renderLoadedModal();

    fireEvent.click(screen.getByRole("dialog", { name: /acme corp/i }).parentElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("edit button enters edit mode and shows inline publisher and contract inputs", async () => {
    const user = userEvent.setup();
    await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /edit contract/i }));

    expect(screen.getByDisplayValue("Acme Corp")).toBeInTheDocument();
    expect(screen.getByDisplayValue("CN-100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  test("clean edit Cancel exits edit mode without closing modal", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /edit contract/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Acme Corp" })).toBeInTheDocument();
  });

  test("dirty edit Cancel discard exits edit mode but does not close", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /edit contract/i }));
    await user.clear(screen.getByDisplayValue("Acme Corp"));
    await user.type(screen.getByPlaceholderText("Publisher name"), "Changed Corp");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByRole("dialog", { name: /discard unsaved changes/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(screen.getByDisplayValue("Changed Corp")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await user.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  test("dirty close button discard calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /edit contract/i }));
    await user.clear(screen.getByDisplayValue("Acme Corp"));
    await user.type(screen.getByPlaceholderText("Publisher name"), "Changed Corp");
    await user.click(screen.getByRole("button", { name: /^close$/i }));

    expect(await screen.findByRole("dialog", { name: /discard unsaved changes/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("dirty edit Escape discard exits edit mode but does not close", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /edit contract/i }));
    await user.clear(screen.getByDisplayValue("Acme Corp"));
    await user.type(screen.getByPlaceholderText("Publisher name"), "Changed Corp");
    await user.keyboard("{Escape}");

    expect(await screen.findByRole("dialog", { name: /discard unsaved changes/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  test("Save sends the same updateContract payload shape", async () => {
    const user = userEvent.setup();
    contractsApi.updateContract.mockResolvedValue({
      data: { ...baseContract, publisherName: "Changed Corp", contractNumber: "CN-200", notes: "Updated note" },
      error: null,
    });
    await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /edit contract/i }));
    await user.clear(screen.getByDisplayValue("Acme Corp"));
    await user.type(screen.getByPlaceholderText("Publisher name"), "Changed Corp");
    await user.clear(screen.getByDisplayValue("CN-100"));
    await user.type(screen.getByPlaceholderText("Contract number"), "CN-200");
    await user.clear(screen.getByLabelText(/notes/i));
    await user.type(screen.getByLabelText(/notes/i), "Updated note");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(contractsApi.updateContract).toHaveBeenCalledWith(10, {
        publisher_name: "Changed Corp",
        contract_number: "CN-200",
        notes: "Updated note",
      });
    });
  });

  test("nested delete folder and document confirmations call the right APIs", async () => {
    const user = userEvent.setup();
    contractsApi.deleteFolder.mockResolvedValue({ error: null });
    contractsApi.deleteContractDocument.mockResolvedValue({ error: null });
    await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /delete folder/i }));
    let confirm = screen.getByRole("dialog", { name: /delete folder/i });
    await user.click(within(confirm).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(contractsApi.deleteFolder).toHaveBeenCalledWith(10, 7));

    await user.click(screen.getByRole("button", { name: /toggle general folder/i }));
    await user.click(screen.getAllByRole("button", { name: /delete document/i })[0]);
    confirm = screen.getByRole("dialog", { name: /delete document/i });
    await user.click(within(confirm).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(contractsApi.deleteContractDocument).toHaveBeenCalledWith(10, 21));
  });

  test("read-only viewers cannot trigger contract document downloads", async () => {
    const user = userEvent.setup();
    await renderLoadedModal({
      user: { id: 2, role: "viewer", username: "viewer", allowDownloads: false },
    });

    await user.click(screen.getByRole("button", { name: /toggle general folder/i }));
    const documentButton = screen.getByRole("button", { name: /general\.pdf/i });

    expect(documentButton).toBeDisabled();
    await user.click(documentButton);
    expect(contractsApi.downloadContractDocument).not.toHaveBeenCalled();
  });

  test("missing contract document rows remain visible with downloads disabled", async () => {
    const user = userEvent.setup();
    await renderLoadedModal({}, {
      documents: [
        { id: 21, originalFilename: "general.pdf", folderId: null, fileAvailability: "missing" },
      ],
    });

    await user.click(screen.getByRole("button", { name: /toggle general folder/i }));
    const documentButton = screen.getByRole("button", { name: /general\.pdf/i });

    expect(documentButton).toBeDisabled();
    expect(screen.getByText("File missing")).toBeInTheDocument();
    await user.click(documentButton);
    expect(contractsApi.downloadContractDocument).not.toHaveBeenCalled();
  });

  test("folder rename Escape cancels rename without closing modal", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderLoadedModal();

    await user.click(screen.getByRole("button", { name: /rename folder/i }));
    expect(screen.getByDisplayValue("Invoices")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Invoices")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /acme corp/i })).toBeInTheDocument();
  });
});
