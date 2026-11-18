import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SignInPage from "./SignInPage";

const authMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: authMocks },
}));

function renderSignInPage() {
  render(
    <MemoryRouter>
      <SignInPage authError={null} />
    </MemoryRouter>,
  );
}

describe("SignInPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    authMocks.signInWithPassword.mockResolvedValue({ error: null });
    authMocks.signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });
  });

  it("signs in with the entered email and password", async () => {
    const user = userEvent.setup();
    renderSignInPage();

    await user.type(screen.getByLabelText("Email address"), "trainer@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(
      within(screen.getByRole("form", { name: "Authentication form" }))
        .getByRole("button", { name: "Sign in" }),
    );

    await waitFor(() => {
      expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
        email: "trainer@example.com",
        password: "password123",
      });
    });
    expect(screen.getByRole("status").textContent).toContain("Signed in successfully");
  });

  it("creates an account and prompts the user to confirm their email", async () => {
    const user = userEvent.setup();
    renderSignInPage();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await user.type(screen.getByLabelText("Email address"), "new-trainer@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(
      within(screen.getByRole("form", { name: "Authentication form" }))
        .getByRole("button", { name: "Create account" }),
    );

    await waitFor(() => expect(authMocks.signUp).toHaveBeenCalledTimes(1));
    expect(authMocks.signUp).toHaveBeenCalledWith({
      email: "new-trainer@example.com",
      password: "password123",
      options: { emailRedirectTo: expect.stringMatching(/\/$/) },
    });
    expect(screen.getByRole("status").textContent).toContain("confirmation link");
  });

  it("rejects mismatched passwords without sending a signup request", async () => {
    const user = userEvent.setup();
    renderSignInPage();
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await user.type(screen.getByLabelText("Email address"), "new-trainer@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "different123");
    await user.click(
      within(screen.getByRole("form", { name: "Authentication form" }))
        .getByRole("button", { name: "Create account" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain("passwords don’t match");
    expect(authMocks.signUp).not.toHaveBeenCalled();
  });
});
