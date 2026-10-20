/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormErrorSummary } from "../form-error-summary";
import type { FieldError } from "@/lib/validation/form-error-summary";

function error(overrides: Partial<FieldError> = {}): FieldError {
  return {
    fieldId: "amount",
    label: "Amount",
    message: "Amount is required",
    source: "client",
    ...overrides,
  };
}

/** A minimal form with a real labeled input matching a fieldId, so focus-target tests exercise a real DOM element. */
function TestForm({ errors }: { errors: FieldError[] }) {
  return (
    <form>
      <FormErrorSummary errors={errors} />
      <label htmlFor="amount">Amount</label>
      <input id="amount" />
      <label htmlFor="currency">Currency</label>
      <input id="currency" />
    </form>
  );
}

describe("FormErrorSummary — rendering", () => {
  it("renders nothing when there are no errors", () => {
    render(<TestForm errors={[]} />);
    expect(screen.queryByTestId("form-error-summary")).not.toBeInTheDocument();
  });

  it("lists each error with its label and message", () => {
    render(
      <TestForm
        errors={[
          error({ fieldId: "amount", label: "Amount", message: "Amount is required" }),
          error({ fieldId: "currency", label: "Currency", message: "Select a currency" }),
        ]}
      />,
    );
    expect(screen.getByText("Amount: Amount is required")).toBeInTheDocument();
    expect(screen.getByText("Currency: Select a currency")).toBeInTheDocument();
  });
});

describe("FormErrorSummary — screen-reader announcements", () => {
  it("uses role=alert so the summary is announced immediately when it appears", () => {
    render(<TestForm errors={[error()]} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("has an accessible heading linked via aria-labelledby", () => {
    render(<TestForm errors={[error()]} />);
    const summary = screen.getByTestId("form-error-summary");
    expect(summary).toHaveAttribute("aria-labelledby", "form-error-summary-heading");
    expect(screen.getByText("There is a problem")).toHaveAttribute(
      "id",
      "form-error-summary-heading",
    );
  });

  it("accepts a custom heading", () => {
    render(<TestForm errors={[error()]} heading={undefined} />);
    expect(screen.getByText("There is a problem")).toBeInTheDocument();
  });
});

describe("FormErrorSummary — focus moves to the summary on first appearance", () => {
  it("focuses the summary element when errors first appear", () => {
    const { rerender } = render(<TestForm errors={[]} />);
    rerender(<TestForm errors={[error()]} />);
    expect(screen.getByTestId("form-error-summary")).toHaveFocus();
  });

  it("does not re-focus the summary on every re-render while errors are already present", () => {
    const { rerender } = render(<TestForm errors={[error()]} />);
    const summary = screen.getByTestId("form-error-summary");
    summary.blur();
    rerender(<TestForm errors={[error({ message: "Still required" })]} />);
    // Still showing the same count (1 error) — focus should not have been
    // re-stolen back to the summary a second time.
    expect(summary).not.toHaveFocus();
  });
});

describe("FormErrorSummary — focus navigation to fields", () => {
  it("clicking a summary entry moves focus to the corresponding field", async () => {
    const user = userEvent.setup();
    render(<TestForm errors={[error({ fieldId: "amount" })]} />);

    await user.click(screen.getByText("Amount: Amount is required"));
    expect(screen.getByLabelText("Amount")).toHaveFocus();
  });

  it("navigating to a field via keyboard (Enter on a focused link) also moves focus", async () => {
    const user = userEvent.setup();
    render(<TestForm errors={[error({ fieldId: "currency", label: "Currency", message: "Required" })]} />);

    const link = screen.getByText("Currency: Required");
    link.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Currency")).toHaveFocus();
  });

  it("does not lose entered data when navigating to a field via the summary", async () => {
    const user = userEvent.setup();
    render(<TestForm errors={[error({ fieldId: "amount" })]} />);

    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "already typed value" } });

    await user.click(screen.getByText("Amount: Amount is required"));

    expect(amountInput.value).toBe("already typed value");
    expect(amountInput).toHaveFocus();
  });
});

describe("FormErrorSummary — corrected errors", () => {
  it("removing a corrected field's error from the list removes its summary entry", () => {
    const { rerender } = render(
      <TestForm
        errors={[
          error({ fieldId: "amount" }),
          error({ fieldId: "currency", label: "Currency", message: "Required" }),
        ]}
      />,
    );
    expect(screen.getByText("Currency: Required")).toBeInTheDocument();

    // "currency" was corrected; only "amount" remains invalid.
    rerender(<TestForm errors={[error({ fieldId: "amount" })]} />);

    expect(screen.queryByText("Currency: Required")).not.toBeInTheDocument();
    expect(screen.getByText("Amount: Amount is required")).toBeInTheDocument();
  });

  it("the summary disappears entirely once every error is corrected", () => {
    const { rerender } = render(<TestForm errors={[error()]} />);
    expect(screen.getByTestId("form-error-summary")).toBeInTheDocument();

    rerender(<TestForm errors={[]} />);
    expect(screen.queryByTestId("form-error-summary")).not.toBeInTheDocument();
  });
});

describe("FormErrorSummary — dynamic fields", () => {
  it("reflects a newly-appearing dynamic field's error once it shows up in the errors list", () => {
    const { rerender } = render(<TestForm errors={[]} />);
    rerender(<TestForm errors={[error({ fieldId: "amount" })]} />);
    expect(screen.getByText("Amount: Amount is required")).toBeInTheDocument();
  });

  it("each dynamic field entry has a unique, stable key (fieldId) even across re-renders", () => {
    const errors = [
      error({ fieldId: "items.0.amount", label: "Item 1 amount" }),
      error({ fieldId: "items.1.amount", label: "Item 2 amount" }),
    ];
    const { rerender } = render(<TestForm errors={errors} />);
    expect(screen.getByText("Item 1 amount: Amount is required")).toBeInTheDocument();
    expect(screen.getByText("Item 2 amount: Amount is required")).toBeInTheDocument();

    rerender(<TestForm errors={errors} />);
    expect(screen.getByText("Item 1 amount: Amount is required")).toBeInTheDocument();
  });
});
