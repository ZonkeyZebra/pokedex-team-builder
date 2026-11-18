import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ForgotPasswordPage from "./ForgotPasswordPage";
import ResetPasswordPage from "./ResetPasswordPage";

const authMocks = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  session: { user: { id: "test-user" } } as { user: { id: string } } | null,
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: authMocks },
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ session: authMocks.session, loading: false }),
}));

describe("password recovery", () => {
  afterEach(cleanup);

  beforeEach(() => {
    authMocks.session = { user: { id: "test-user" } };
    authMocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    authMocks.updateUser.mockResolvedValue({ error: null });
  });

  it("sends a reset email with the app's reset route as redirect", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>);

    await user.type(screen.getByLabelText("Email address"), "trainer@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(authMocks.resetPasswordForEmail).toHaveBeenCalledWith(
        "trainer@example.com",
        { redirectTo: expect.stringMatching(/\/reset-password$/) },
      );
    });
    expect(screen.getByRole("status").textContent).toContain("password reset link");
  });

  it("updates the password after a valid recovery session", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>);

    await user.type(screen.getByLabelText("New password"), "newpassword123");
    await user.type(screen.getByLabelText("Confirm new password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(authMocks.updateUser).toHaveBeenCalledWith({ password: "newpassword123" });
    });
    expect(screen.getByRole("status").textContent).toContain("password has been updated");
    expect(screen.getByRole("link", { name: "Continue to the app" }).getAttribute("href")).toBe("/home");
  });

  it("does not allow a reset without an authenticated recovery session", () => {
    authMocks.session = null;
    render(<MemoryRouter><ResetPasswordPage /></MemoryRouter>);

    expect(screen.getByText(/invalid or expired/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Request another reset link" })).toBeTruthy();
  });
});
