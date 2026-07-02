import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import EmailTemplatesModal from "../components/settings/EmailTemplatesModal.jsx";

const INITIAL_DRAFT = {
  emailTemplateBudgetOwnerIntro: "Budget intro",
  emailTemplateBudgetOwnerSignoff: "Budget signoff",
  emailTemplateManagerIntro: "Manager intro",
};

function renderModal(props = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();

  function Harness() {
    const [draft, setDraft] = React.useState(INITIAL_DRAFT);
    return (
      <EmailTemplatesModal
        draft={draft}
        onChange={setDraft}
        onSave={onSave}
        onCancel={onCancel}
        saving={false}
        {...props}
      />
    );
  }

  render(<Harness />);
  return { onSave, onCancel };
}

describe("EmailTemplatesModal", () => {
  test("updates draft fields and saves", async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();

    const intro = screen.getByLabelText(/intro paragraph/i);
    await user.clear(intro);
    await user.type(intro, "New budget intro");

    expect(screen.getByDisplayValue("New budget intro")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("cancel, close, overlay, and Escape cancel the modal", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /close email templates dialog/i }));
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("dialog", { name: /email templates/i }).parentElement);
    expect(onCancel).toHaveBeenCalledTimes(3);

    await user.click(screen.getByLabelText(/intro paragraph/i));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(4);
  });
});
