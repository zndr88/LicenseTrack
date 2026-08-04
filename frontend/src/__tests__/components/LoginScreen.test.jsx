import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginScreen from "../../components/auth/LoginScreen.jsx";

vi.mock("../../api/auth.js", () => ({
  login: vi.fn(),
  getAuthMode: vi.fn().mockResolvedValue({ oidc_enabled: false, oidc_available: false }),
}));

vi.mock("../../components/ui/Icon.jsx", () => ({
  default: () => null,
}));

import { getAuthMode, login as mockLogin } from "../../api/auth.js";

describe("LoginScreen", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    getAuthMode.mockReset();
    getAuthMode.mockResolvedValue({ oidc_enabled: false, oidc_available: false });
    window.history.replaceState({}, "", "/");
  });

  test("username field is empty on mount", async () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    const input = await screen.findByRole("textbox");
    expect(input.value).toBe("");
  });

  test("password field is empty on mount", async () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    const input = await screen.findByPlaceholderText("••••••••••••");
    expect(input.value).toBe("");
  });

  test("local login controls expose their programmatic labels", async () => {
    render(<LoginScreen onLogin={vi.fn()} />);

    expect(await screen.findByLabelText("Username")).toHaveAttribute("id", "login-username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("id", "login-password");
  });

  test("submit with empty fields shows error and does not call login API", async () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /sign in locally/i }));
    expect(await screen.findByText("Username and password are required.")).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  test("successful login calls onLogin with auth provider shape", async () => {
    mockLogin.mockResolvedValue({
      data: {
        access_token: "tok",
        user: {
          id: 1,
          username: "admin",
          role: "admin",
          must_change_password: false,
          auth_provider: "local",
          is_break_glass_admin: true,
        },
      },
      error: null,
    });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "admin" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••••••"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in locally/i }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ username: "admin", authProvider: "local", isBreakGlassAdmin: true }));
  });

  test("renders SSO button only when OIDC is enabled and available", async () => {
    getAuthMode.mockResolvedValue({ oidc_enabled: true, oidc_available: true });
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /sign in with sso/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign in locally/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use local admin login/i })).toBeInTheDocument();
  });

  test("shows OIDC unavailable info without hiding local login", async () => {
    getAuthMode.mockResolvedValue({ oidc_enabled: true, oidc_available: false });
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(await screen.findByText(/SSO is configured but currently unavailable/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /sign in locally/i })).toBeInTheDocument();
  });

  test("shows callback error from query params", async () => {
    window.history.replaceState({}, "", "/?error=not_provisioned");
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(await screen.findByText(/No account was found for this SSO identity/i)).toBeInTheDocument();
  });

  test("reveals local login when requested from the fallback link", async () => {
    getAuthMode.mockResolvedValue({ oidc_enabled: true, oidc_available: true });
    render(<LoginScreen onLogin={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /use local admin login/i }));
    expect(screen.getByText(/Local login is reserved for break-glass and admin access/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in locally/i })).toBeInTheDocument();
  });

  test("reveals local login automatically for local_account errors", async () => {
    getAuthMode.mockResolvedValue({ oidc_enabled: true, oidc_available: true });
    window.history.replaceState({}, "", "/?error=local_account");
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(await screen.findByText(/This account uses local login/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in locally/i })).toBeInTheDocument();
  });
});
