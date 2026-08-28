import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ChangePasswordModal from "../../components/auth/ChangePasswordModal.jsx";
import { changePassword } from "../../api/auth.js";

vi.mock("../../api/auth.js", () => ({
  changePassword: vi.fn(),
}));

vi.mock("../../components/ui/Icon.jsx", () => ({
  default: () => null,
}));

describe("ChangePasswordModal", () => {
  beforeEach(() => {
    changePassword.mockReset();
  });

  test("submits password length validation to the configured server policy", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    changePassword.mockResolvedValue({ error: "Password must be at least 16 characters" });
    render(<ChangePasswordModal onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText("Current Password"), "current-password");
    await user.type(screen.getByLabelText("New Password"), "short");
    await user.type(screen.getByLabelText("Confirm New Password"), "short");
    await user.click(screen.getByRole("button", { name: "Set New Password" }));

    expect(changePassword).toHaveBeenCalledWith("current-password", "short");
    expect(await screen.findByText("Password must be at least 16 characters")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("keeps required and confirmation checks local", async () => {
    const user = userEvent.setup();
    render(<ChangePasswordModal onSuccess={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Set New Password" }));
    expect(screen.getByText("All fields are required.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Current Password"), "current-password");
    await user.type(screen.getByLabelText("New Password"), "first-password");
    await user.type(screen.getByLabelText("Confirm New Password"), "different-password");
    await user.click(screen.getByRole("button", { name: "Set New Password" }));

    expect(screen.getByText("New passwords do not match.")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });
});
