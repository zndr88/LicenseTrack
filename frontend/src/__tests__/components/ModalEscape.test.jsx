import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import ModalShell from "../../components/ui/ModalShell.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import DiscardChangesDialog from "../../components/ui/DiscardChangesDialog.jsx";
import { useModalGuard } from "../../hooks/useModalGuard.js";

vi.mock("../../components/ui/Icon.jsx", () => ({
  default: () => null,
}));

const pressEscape = (target = document.body) => fireEvent.keyDown(target, { key: "Escape" });

describe("Escape in dialogs", () => {
  test("closes a modal, also when focus is outside it", () => {
    const onClose = vi.fn();
    render(<ModalShell title="Coverage history" titleId="t" onClose={onClose}><div>Body</div></ModalShell>);

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("uses onEscape instead of onClose when given", () => {
    const onClose = vi.fn();
    const onEscape = vi.fn();
    render(<ModalShell title="Edit" titleId="t" onClose={onClose} onEscape={onEscape}><div>Body</div></ModalShell>);

    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("does nothing when the modal opts out or its close button is disabled", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ModalShell title="Busy" titleId="t" onClose={onClose} closeOnEscape={false}><div>Body</div></ModalShell>,
    );
    pressEscape();

    rerender(<ModalShell title="Busy" titleId="t" onClose={onClose} closeButtonDisabled><div>Body</div></ModalShell>);
    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
  });

  test("leaves Escape to an open combobox list", () => {
    const onClose = vi.fn();
    render(
      <ModalShell title="Edit" titleId="t" onClose={onClose}>
        <input role="combobox" aria-expanded="true" aria-controls="x" aria-label="Publisher" />
      </ModalShell>,
    );

    pressEscape(screen.getByRole("combobox"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("leaves Escape to a field that already handled it", () => {
    const onClose = vi.fn();
    render(
      <ModalShell title="Edit" titleId="t" onClose={onClose}>
        <input aria-label="Rename" onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }} />
      </ModalShell>,
    );

    pressEscape(screen.getByLabelText("Rename"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("closes only the topmost of two open dialogs", () => {
    const closeLower = vi.fn();
    const closeUpper = vi.fn();
    render(
      <>
        <ModalShell title="Lower" titleId="lower" onClose={closeLower}><div>Body</div></ModalShell>
        <ConfirmDialog title="Upper" message="Sure?" onConfirm={vi.fn()} onCancel={closeUpper} />
      </>,
    );

    pressEscape();
    expect(closeUpper).toHaveBeenCalledTimes(1);
    expect(closeLower).not.toHaveBeenCalled();
  });

  test("cancels a confirmation dialog", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Delete license" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);

    pressEscape();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("a confirmation dialog starts with focus on Cancel", () => {
    render(<ConfirmDialog title="Delete license" message="Sure?" danger onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  test("keeps editing from the discard-changes dialog", () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<DiscardChangesDialog onDiscard={onDiscard} onKeep={onKeep} />);

    pressEscape();
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  function GuardedModal({ onClose }) {
    const [value, setValue] = useState("");
    const { showDiscardDialog, setShowDiscardDialog, requestClose } = useModalGuard({ isDirty: value !== "", onClose });
    return (
      <>
        <ModalShell title="Edit notes" titleId="t" onClose={requestClose}>
          <input aria-label="Notes" value={value} onChange={(event) => setValue(event.target.value)} />
        </ModalShell>
        {showDiscardDialog && (
          <DiscardChangesDialog onDiscard={onClose} onKeep={() => setShowDiscardDialog(false)} />
        )}
      </>
    );
  }

  test("a changed form asks first, and a second Escape returns to the form", () => {
    const onClose = vi.fn();
    render(<GuardedModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "typed" } });

    pressEscape();
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    pressEscape();
    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("typed");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("an unchanged guarded form closes at once", () => {
    const onClose = vi.fn();
    render(<GuardedModal onClose={onClose} />);

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
