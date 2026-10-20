import {
  filterVisibleFieldErrors,
  findDuplicateFieldIds,
  mergeFieldErrors,
  type FieldError,
} from "../form-error-summary";

function error(overrides: Partial<FieldError> = {}): FieldError {
  return {
    fieldId: "amount",
    label: "Amount",
    message: "Amount is required",
    source: "client",
    ...overrides,
  };
}

describe("mergeFieldErrors", () => {
  it("merges client and server errors with no overlap", () => {
    const client = [error({ fieldId: "amount" })];
    const server = [error({ fieldId: "currency", label: "Currency", message: "Invalid currency" })];
    const merged = mergeFieldErrors(client, server);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.fieldId).sort()).toEqual(["amount", "currency"]);
  });

  it("deduplicates when both client and server flag the same field, keeping only one entry", () => {
    const client = [error({ fieldId: "amount", message: "Must be positive", source: "client" })];
    const server = [error({ fieldId: "amount", message: "Amount exceeds account balance", source: "server" })];
    const merged = mergeFieldErrors(client, server);
    expect(merged).toHaveLength(1);
  });

  it("prefers the server error's message when both sources flag the same field", () => {
    const client = [error({ fieldId: "amount", message: "Client-side guess", source: "client" })];
    const server = [error({ fieldId: "amount", message: "Server-authoritative message", source: "server" })];
    const merged = mergeFieldErrors(client, server);
    expect(merged[0].message).toBe("Server-authoritative message");
    expect(merged[0].source).toBe("server");
  });

  it("handles empty client and/or server lists", () => {
    expect(mergeFieldErrors([], [])).toEqual([]);
    expect(mergeFieldErrors([error()], [])).toHaveLength(1);
    expect(mergeFieldErrors([], [error()])).toHaveLength(1);
  });
});

describe("filterVisibleFieldErrors", () => {
  it("keeps only errors for fields the caller reports as currently visible", () => {
    const errors = [
      error({ fieldId: "amount" }),
      error({ fieldId: "hidden-field", label: "Hidden" }),
    ];
    const visible = filterVisibleFieldErrors(errors, (fieldId) => fieldId === "amount");
    expect(visible).toHaveLength(1);
    expect(visible[0].fieldId).toBe("amount");
  });

  it("returns an empty list when nothing is visible", () => {
    const errors = [error({ fieldId: "amount" })];
    expect(filterVisibleFieldErrors(errors, () => false)).toEqual([]);
  });

  it("returns everything when everything is visible", () => {
    const errors = [error({ fieldId: "a" }), error({ fieldId: "b" })];
    expect(filterVisibleFieldErrors(errors, () => true)).toHaveLength(2);
  });
});

describe("findDuplicateFieldIds — nested/repeated field uniqueness", () => {
  it("finds no duplicates when every fieldId is already unique, even for similarly-named repeated fields", () => {
    const errors = [
      error({ fieldId: "items.0.amount" }),
      error({ fieldId: "items.1.amount" }),
      error({ fieldId: "items.2.amount" }),
    ];
    expect(findDuplicateFieldIds(errors)).toEqual([]);
  });

  it("flags a genuine duplicate fieldId (a repeated-field bug where the index was forgotten)", () => {
    const errors = [
      error({ fieldId: "amount" }), // should have been "items.0.amount"
      error({ fieldId: "amount" }), // should have been "items.1.amount"
    ];
    expect(findDuplicateFieldIds(errors)).toEqual(["amount"]);
  });

  it("returns an empty list for an empty input", () => {
    expect(findDuplicateFieldIds([])).toEqual([]);
  });
});
