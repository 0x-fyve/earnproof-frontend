"use client";

import { useCallback, useRef, useState } from "react";
import {
  checkSchemaImportFile,
  checkSchemaImportPaste,
  parseSchemaImportPayload,
  MAX_SCHEMA_IMPORT_BYTES,
  MAX_SCHEMAS_PER_IMPORT,
  MAX_POLICY_MAPPINGS_PER_IMPORT,
  ALLOWED_SCHEMA_IMPORT_EXTENSIONS,
} from "@/lib/validation/schema-import";
import type { SchemaImportPayload, ParseImportPayloadResult } from "@/lib/validation/schema-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaImportFormProps = {
  onValidPayload: (payload: SchemaImportPayload, rawText: string) => void;
};

type InputMode = "file" | "paste";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Schema Import Form
 *
 * Accepts schema metadata and policy mapping input via:
 *  1. File upload (drag-and-drop or browse)
 *  2. Paste/type raw JSON
 *
 * All local validation (size, extension, MIME, JSON parse, schema violations)
 * is performed before calling onValidPayload.  No network request is made
 * from this component — it only drives the input and local validation phase.
 *
 * Accessibility:
 *  - All inputs are labeled
 *  - Errors use role="alert" and aria-live="polite"
 *  - File input is keyboard-operable via the visible label/button
 *  - Focus moves to the first error summary after validation failure
 */
export function SchemaImportForm({ onValidPayload }: SchemaImportFormProps) {
  const [mode, setMode] = useState<InputMode>("file");
  const [pasteText, setPasteText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<{
    general?: string;
    fields: Record<string, string>;
  }>({ fields: {} });
  const [isReading, setIsReading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  // Focus the error summary region when errors appear so screen reader users
  // are immediately informed of the problem.
  const focusErrorSummary = useCallback(() => {
    // Deferred so the DOM update lands before the focus call
    setTimeout(() => {
      errorSummaryRef.current?.focus();
    }, 0);
  }, []);

  const clearErrors = useCallback(() => {
    setLocalErrors({ fields: {} });
  }, []);

  // ---------------------------------------------------------------------------
  // Core validation — defined before processFile so it can be a dep
  // ---------------------------------------------------------------------------

  const validateAndNotify = useCallback(
    (rawText: string) => {
      const pasteCheck = checkSchemaImportPaste(rawText);
      if (!pasteCheck.ok) {
        const message =
          pasteCheck.reason === "oversized"
            ? `Input exceeds the maximum allowed size of ${MAX_SCHEMA_IMPORT_BYTES / 1024} KB.`
            : "Input is empty. Please provide a JSON payload.";
        setLocalErrors({ general: message, fields: {} });
        focusErrorSummary();
        return;
      }

      const result: ParseImportPayloadResult = parseSchemaImportPayload(rawText);
      if (!result.ok) {
        setLocalErrors({ general: result.message, fields: result.fieldErrors });
        focusErrorSummary();
        return;
      }

      clearErrors();
      onValidPayload(result.payload, rawText);
    },
    [clearErrors, focusErrorSummary, onValidPayload],
  );

  // ---------------------------------------------------------------------------
  // File gate + read
  // ---------------------------------------------------------------------------

  const processFile = useCallback(
    (file: File) => {
      clearErrors();

      const check = checkSchemaImportFile({
        name: file.name,
        size: file.size,
        type: file.type,
      });

      if (!check.ok) {
        const message =
          check.reason === "oversized"
            ? `File is too large. Maximum allowed size is ${MAX_SCHEMA_IMPORT_BYTES / 1024} KB.`
            : check.reason === "empty"
              ? "File is empty. Please provide a non-empty JSON file."
              : `Unsupported file type. Only ${ALLOWED_SCHEMA_IMPORT_EXTENSIONS.join(", ")} files are accepted.`;
        setLocalErrors({ general: message, fields: {} });
        focusErrorSummary();
        return;
      }

      setIsReading(true);
      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        setIsReading(false);
        const text = typeof e.target?.result === "string" ? e.target.result : "";
        validateAndNotify(text);
      };
      reader.onerror = () => {
        setIsReading(false);
        setLocalErrors({
          general: "Failed to read the file. Please try again.",
          fields: {},
        });
        focusErrorSummary();
      };
      reader.readAsText(file);
    },
    [clearErrors, focusErrorSummary, validateAndNotify],
  );

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handlePasteSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      clearErrors();
      setFileName(null);
      validateAndNotify(pasteText);
    },
    [pasteText, clearErrors, validateAndNotify],
  );

  const hasErrors = !!localErrors.general || Object.keys(localErrors.fields).length > 0;
  const fieldErrorList = Object.entries(localErrors.fields);

  return (
    <div className="grid gap-6">
      {/* Mode selector */}
      <div
        role="tablist"
        aria-label="Import input method"
        className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1 w-fit"
      >
        <button
          role="tab"
          aria-selected={mode === "file"}
          aria-controls="import-panel-file"
          id="import-tab-file"
          type="button"
          onClick={() => { setMode("file"); clearErrors(); setFileName(null); }}
          className={`h-8 rounded-md px-4 text-xs font-semibold transition ${
            mode === "file"
              ? "bg-cyan-300 text-slate-950"
              : "text-slate-300 hover:text-white hover:bg-white/5"
          }`}
        >
          File upload
        </button>
        <button
          role="tab"
          aria-selected={mode === "paste"}
          aria-controls="import-panel-paste"
          id="import-tab-paste"
          type="button"
          onClick={() => { setMode("paste"); clearErrors(); setFileName(null); }}
          className={`h-8 rounded-md px-4 text-xs font-semibold transition ${
            mode === "paste"
              ? "bg-cyan-300 text-slate-950"
              : "text-slate-300 hover:text-white hover:bg-white/5"
          }`}
        >
          Paste JSON
        </button>
      </div>

      {/* Error summary — aria-live ensures screen readers announce updates */}
      {hasErrors && (
        <div
          ref={errorSummaryRef}
          role="alert"
          aria-live="polite"
          tabIndex={-1}
          className="rounded-md border border-rose-300/30 bg-rose-300/10 p-4 focus:outline-none"
        >
          {localErrors.general && (
            <p className="text-sm font-medium text-rose-200">{localErrors.general}</p>
          )}
          {fieldErrorList.length > 0 && (
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {fieldErrorList.map(([path, msg]) => (
                <li key={path} className="text-xs text-rose-200">
                  <span className="font-mono text-rose-300">{path}</span>: {msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* File upload panel */}
      {mode === "file" && (
        <div
          id="import-panel-file"
          role="tabpanel"
          aria-labelledby="import-tab-file"
          className="grid gap-4"
        >
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition ${
              isDragging
                ? "border-cyan-300/70 bg-cyan-300/5"
                : "border-white/15 bg-white/[0.02] hover:bg-white/[0.03]"
            }`}
          >
            <svg
              aria-hidden="true"
              className="mb-3 h-10 w-10 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>

            <p className="text-sm font-medium text-white">
              Drag and drop a JSON file, or{" "}
              <label
                htmlFor="schema-file-input"
                className="cursor-pointer text-cyan-300 underline hover:text-cyan-200"
              >
                browse to upload
              </label>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              JSON only · Max {MAX_SCHEMA_IMPORT_BYTES / 1024} KB ·{" "}
              Max {MAX_SCHEMAS_PER_IMPORT} schemas · Max {MAX_POLICY_MAPPINGS_PER_IMPORT} mappings
            </p>

            {/* Hidden but keyboard-accessible file input */}
            <input
              id="schema-file-input"
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Schema import JSON file"
              onChange={handleFileChange}
              className="sr-only"
            />
          </div>

          {/* Selected file feedback */}
          {fileName && !hasErrors && (
            <div
              aria-live="polite"
              className="flex items-center gap-2 rounded-md border border-cyan-300/30 bg-cyan-300/5 px-4 py-2 text-sm text-cyan-200"
            >
              <svg aria-hidden="true" className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                <span className="font-medium">File loaded:</span> {fileName}
              </span>
            </div>
          )}

          {isReading && (
            <p aria-live="polite" className="text-xs text-slate-400">
              Reading file…
            </p>
          )}
        </div>
      )}

      {/* Paste panel */}
      {mode === "paste" && (
        <div
          id="import-panel-paste"
          role="tabpanel"
          aria-labelledby="import-tab-paste"
        >
          <form onSubmit={handlePasteSubmit} className="grid gap-4">
            <div>
              <label
                htmlFor="schema-paste-input"
                className="block text-sm font-medium text-slate-200"
              >
                Paste JSON payload
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Paste the schema import JSON directly. Max {MAX_SCHEMA_IMPORT_BYTES / 1024} KB.
              </p>
              <textarea
                id="schema-paste-input"
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); clearErrors(); }}
                rows={14}
                spellCheck={false}
                aria-describedby={hasErrors ? "paste-error-summary" : undefined}
                placeholder={`{\n  "schemas": [\n    {\n      "id": "my-schema.v1",\n      "version": "1.0.0",\n      "name": "My Schema"\n    }\n  ],\n  "policyMappings": []\n}`}
                className={`mt-2 w-full rounded-md border bg-slate-900 px-4 py-3 font-mono text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-300 ${
                  hasErrors ? "border-rose-500 bg-rose-900/20" : "border-white/10"
                }`}
              />
            </div>

            <button
              type="submit"
              disabled={!pasteText.trim()}
              className="h-10 w-fit rounded-md bg-cyan-300 px-6 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-cyan-200 transition"
            >
              Validate and preview
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
