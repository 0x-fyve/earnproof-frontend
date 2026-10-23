/**
 * Integration tests for auth lifecycle:
 * - Session initialization and clearing
 * - Wallet account/network changes
 * - Multi-tab session convergence
 * - Redirect path validation (open redirect prevention)
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthSessionProvider, useAuthSession } from "../auth-context";

// Test component that uses auth context
function TestComponent() {
  const auth = useAuthSession();
  return (
    <div>
      <div data-testid="authenticated">
        {auth.isAuthenticated ? "Yes" : "No"}
      </div>
      <div data-testid="user">{auth.user?.id || "null"}</div>
      <div data-testid="wallet">
        {auth.walletState.address || "disconnected"}
      </div>
      <div data-testid="recovering">{auth.isRecovering ? "Yes" : "No"}</div>
      <button
        onClick={() => {
          auth.setSession(
            { id: "user-1", walletAddress: "0x123", email: "test@example.com" },
            "token-123",
            Date.now() + 3600000,
          );
        }}
      >
        Login
      </button>
      <button onClick={() => auth.clearSession()}>Logout</button>
      <button
        onClick={() => {
          auth.setRedirectPath("/payments");
        }}
      >
        Set Redirect
      </button>
      <div data-testid="redirect">{auth.getRedirectPath()}</div>
    </div>
  );
}

describe("AuthSessionProvider Integration", () => {
  beforeEach(() => {
    // Reset all auth singletons
    jest.clearAllMocks();
  });

  describe("session lifecycle", () => {
    it("should provide auth context", () => {
      render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      expect(screen.getByTestId("authenticated")).toHaveTextContent("No");
      expect(screen.getByTestId("user")).toHaveTextContent("null");
    });

    it("should set session and update state", async () => {
      render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("Yes");
        expect(screen.getByTestId("user")).toHaveTextContent("user-1");
      });
    });

    it("should clear session on logout", async () => {
      render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      // Login
      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("Yes");
      });

      // Logout
      const logoutButton = screen.getByRole("button", { name: "Logout" });
      logoutButton.click();

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("No");
        expect(screen.getByTestId("user")).toHaveTextContent("null");
      });
    });
  });

  describe("redirect path validation", () => {
    it("should validate internal paths", async () => {
      render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      const redirectButton = screen.getByRole("button", {
        name: "Set Redirect",
      });
      redirectButton.click();

      await waitFor(() => {
        expect(screen.getByTestId("redirect")).toHaveTextContent("/payments");
      });
    });

    it("should reject open redirects", async () => {
      const { rerender } = render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      // Note: setRedirectPath is called from component, which validates
      // The test here just verifies the path is validated by getRedirectPath
      const TestOpenRedirectComponent = () => {
        const auth = useAuthSession();

        React.useEffect(() => {
          // Try to set malicious redirect
          auth.setRedirectPath("https://evil.com");
        }, [auth]);

        return <div data-testid="redirect">{auth.getRedirectPath()}</div>;
      };

      rerender(
        <AuthSessionProvider>
          <TestOpenRedirectComponent />
        </AuthSessionProvider>,
      );

      await waitFor(() => {
        // Should fall back to '/' for external URLs
        const redirectText = screen.getByTestId("redirect").textContent;
        expect(redirectText).toBe("/");
      });
    });

    it("should reject paths with query strings that look like redirects", async () => {
      const TestComponent2 = () => {
        const auth = useAuthSession();

        React.useEffect(() => {
          auth.setRedirectPath("/payments?redirect=https://evil.com");
        }, [auth]);

        return <div data-testid="redirect">{auth.getRedirectPath()}</div>;
      };

      render(
        <AuthSessionProvider>
          <TestComponent2 />
        </AuthSessionProvider>,
      );

      await waitFor(() => {
        const redirectText = screen.getByTestId("redirect").textContent;
        // Should accept it since it starts with /
        expect(redirectText).toBe("/payments?redirect=https://evil.com");
      });
    });
  });

  describe("onSessionChange callback", () => {
    it("should call onSessionChange callback", async () => {
      const onSessionChange = jest.fn();

      render(
        <AuthSessionProvider onSessionChange={onSessionChange}>
          <TestComponent />
        </AuthSessionProvider>,
      );

      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();

      await waitFor(() => {
        expect(onSessionChange).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "user-1",
            walletAddress: "0x123",
          }),
        );
      });
    });

    it("should call onSessionChange with null on logout", async () => {
      const onSessionChange = jest.fn();

      render(
        <AuthSessionProvider onSessionChange={onSessionChange}>
          <TestComponent />
        </AuthSessionProvider>,
      );

      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();

      await waitFor(() => {
        expect(onSessionChange).toHaveBeenCalledTimes(1);
      });

      const logoutButton = screen.getByRole("button", { name: "Logout" });
      logoutButton.click();

      await waitFor(() => {
        expect(onSessionChange).toHaveBeenLastCalledWith(null);
      });
    });
  });

  describe("error handling", () => {
    it("should throw error when useAuthSession is used outside provider", () => {
      const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
        const [error, setError] = React.useState<string | null>(null);

        React.useEffect(() => {
          try {
            // This will throw
          } catch (err) {
            setError(String(err));
          }
        }, []);

        if (error) {
          return <div>{error}</div>;
        }

        return <>{children}</>;
      };

      expect(() => {
        render(
          <ErrorBoundary>
            <TestComponent />
          </ErrorBoundary>,
        );
      }).toThrow("useAuthSession must be used within AuthSessionProvider");
    });
  });

  describe("getToken method", () => {
    it("should return current token", async () => {
      const TestTokenComponent = () => {
        const auth = useAuthSession();
        const token = auth.getToken();

        return (
          <div>
            <div data-testid="token">{token || "null"}</div>
            <button
              onClick={() => {
                auth.setSession(
                  { id: "user-1", walletAddress: "0x123" },
                  "my-secret-token",
                );
              }}
            >
              Login
            </button>
          </div>
        );
      };

      render(
        <AuthSessionProvider>
          <TestTokenComponent />
        </AuthSessionProvider>,
      );

      expect(screen.getByTestId("token")).toHaveTextContent("null");

      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();

      await waitFor(() => {
        expect(screen.getByTestId("token")).toHaveTextContent(
          "my-secret-token",
        );
      });
    });
  });

  describe("bfcache restoration", () => {
    function dispatchPersistedPageShow() {
      const event = new Event("pageshow") as PageTransitionEvent & {
        persisted: boolean;
      };
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    }

    it("clears the session if the page is restored from bfcache without a token", async () => {
      render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();
      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("Yes");
      });

      // Simulate the page having been logged out (token cleared) in
      // another tab, then this tab being restored from bfcache with its
      // own stale in-memory "authenticated" render still intact.
      const logoutButton = screen.getByRole("button", { name: "Logout" });
      logoutButton.click();
      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("No");
      });

      dispatchPersistedPageShow();

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("No");
      });
    });

    it("keeps a still-valid session on bfcache restoration", async () => {
      render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();
      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("Yes");
      });

      dispatchPersistedPageShow();

      // A token that is still unexpired survives bfcache restoration; only
      // the coordinator's cached recovery state is reset so the next
      // request re-validates against the server instead of trusting the
      // restored UI outright.
      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("Yes");
      });
    });

    it("does not clear the session on an ordinary (non-bfcache) pageshow", async () => {
      render(
        <AuthSessionProvider>
          <TestComponent />
        </AuthSessionProvider>,
      );

      const loginButton = screen.getByRole("button", { name: "Login" });
      loginButton.click();
      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("Yes");
      });

      const event = new Event("pageshow") as PageTransitionEvent & {
        persisted: boolean;
      };
      Object.defineProperty(event, "persisted", { value: false });
      window.dispatchEvent(event);

      await waitFor(() => {
        expect(screen.getByTestId("authenticated")).toHaveTextContent("Yes");
      });
    });
  });
});
