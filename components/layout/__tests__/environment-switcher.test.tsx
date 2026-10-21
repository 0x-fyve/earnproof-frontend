/**
 * @jest-environment jsdom
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { OrganizationContextProvider } from "@/lib/organization-context/context";
import { EnvironmentContextProvider } from "@/lib/environment-context/context";
import { EnvironmentSwitcher } from "../environment-switcher";

function renderSwitcher() {
  function Providers({ children }: { children: ReactNode }) {
    return (
      <OrganizationContextProvider initialOrganizationId="org-1">
        <EnvironmentContextProvider>{children}</EnvironmentContextProvider>
      </OrganizationContextProvider>
    );
  }

  return render(
    <Providers>
      <EnvironmentSwitcher />
    </Providers>,
  );
}

describe("EnvironmentSwitcher", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows sandbox as the active environment by default", () => {
    renderSwitcher();
    expect(screen.getByTestId("environment-badge")).toHaveTextContent("Sandbox");
  });

  it("switches to sandbox immediately without a confirmation dialog", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    // Already in sandbox; selecting it again should be a no-op, not a dialog.
    await user.click(screen.getByRole("button", { name: "Sandbox" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires confirmation before switching into production", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: "Production" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /switch to production/i })).toBeInTheDocument();
    // Badge should not have changed yet - switch isn't committed until confirmed.
    expect(screen.getByTestId("environment-badge")).toHaveTextContent("Sandbox");
  });

  it("commits the switch to production once confirmed", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: "Production" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /switch to production/i }));

    await screen.findByText("Production", { selector: '[data-testid="environment-badge"]' });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels the switch and stays in sandbox when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: "Production" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("environment-badge")).toHaveTextContent("Sandbox");
  });

  it("disables the button for the currently active environment", () => {
    renderSwitcher();
    expect(screen.getByRole("button", { name: "Sandbox" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Production" })).not.toBeDisabled();
  });
});
