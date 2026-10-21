/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { AppQueryProvider, createQueryClient } from "../provider";

function Probe() {
  const queryClient = useQueryClient();
  const options = queryClient.getDefaultOptions();
  return (
    <div>
      <span data-testid="retry">{String(options.queries?.retry)}</span>
      <span data-testid="refetch-on-focus">{String(options.queries?.refetchOnWindowFocus)}</span>
    </div>
  );
}

describe("AppQueryProvider (#326)", () => {
  it("provides a QueryClient to its subtree", () => {
    render(
      <AppQueryProvider>
        <Probe />
      </AppQueryProvider>,
    );

    expect(screen.getByTestId("retry")).toHaveTextContent("false");
    expect(screen.getByTestId("refetch-on-focus")).toHaveTextContent("false");
  });
});

describe("createQueryClient (#326)", () => {
  it("disables automatic retries, relying on lib/api/client.ts's own retry policy instead", () => {
    const client = createQueryClient();
    expect(client.getDefaultOptions().queries?.retry).toBe(false);
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("creates a fresh, independent client on each call", () => {
    const clientA = createQueryClient();
    const clientB = createQueryClient();
    expect(clientA).not.toBe(clientB);
  });
});
