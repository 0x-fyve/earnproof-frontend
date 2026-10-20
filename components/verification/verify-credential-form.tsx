"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiClient } from "@/lib/api/client";
import {
  VerificationPanel,
  VerifyProofResponse,
} from "@/components/verification/verification-panel";
import { VerifyResultSkeleton } from "@/components/common/skeleton/verify-result-skeleton";
import { KeyLifecyclePanel } from "@/components/verification/key-lifecycle-panel";
import { checkCredentialFile, parseCredentialJson } from "@/lib/validation/credential-import";
import { discoverSigningKey } from "@/lib/key-lifecycle/registry";
import {
  extractImportedCredentialSummary,
  type ImportedCredentialSummary,
} from "@/lib/credentials/public-state-comparison";
import { CredentialPublicStateComparison } from "@/components/verification/credential-public-state-comparison";

import { defineMessages, formatMessage, formatNumber } from "@/lib/i18n";

const messages = defineMessages("verifyCredential", {
  // A whole sentence with a placeholder: the size can move anywhere a
  // translation needs it, and the number itself is locale-formatted.
  fileTooLarge:
    "File exceeds the 32 KB limit ({size} KB). Paste the credential JSON instead.",
  fileEmpty: "The selected file is empty.",
  fileUnsupportedType: "Only .json credential files are supported.",
  fileNameLabel: "Selected file: {name}",
  removeFileLabel: "Remove selected file {name}",
});

export function VerifyCredentialForm() {
  const [jsonInput, setJsonInput] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [result, setResult] = useState<VerifyProofResponse | null>(null);
  const [importedSummary, setImportedSummary] = useState<ImportedCredentialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  function clearSelectedFile() {
    setFileName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function readCredentialFile(file: File) {
    const check = checkCredentialFile(file);
    if (!check.ok) {
      const errorMessage =
        check.reason === "oversized"
          ? formatMessage(messages.fileTooLarge, {
              size: formatNumber(file.size / 1024, undefined, { maximumFractionDigits: 1 }),
            })
          : check.reason === "empty"
            ? messages.fileEmpty
            : messages.fileUnsupportedType;
      setError(errorMessage);
      clearSelectedFile();
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === "string") {
        setJsonInput(text);
        setFileName(file.name);
        setError(null);
      }
    };
    reader.onerror = () => {
      setError(messages.fileUnsupportedType);
      clearSelectedFile();
    };
    reader.readAsText(file);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    readCredentialFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    readCredentialFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.target === dropZoneRef.current) {
      setIsDraggingOver(false);
    }
  }

  function handleDropZoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openFilePicker();
    }
  }

  // The file input lives inside the drop zone so it shares the same click
  // target. Calling `.click()` on it dispatches a real click event that
  // bubbles right back up to the drop zone's own onClick — without this
  // guard, opening the picker from a keypress (or from the file-name badge's
  // remove button) would recurse into the drop zone's click handler.
  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const parsed = parseCredentialJson(jsonInput);
    if (!parsed.ok) {
      setError(
        parsed.reason === "malformed"
          ? "Enter valid credential JSON."
          : "Credential JSON must include a valid id.",
      );
      return;
    }

    const { id } = parsed;

    // Extracted purely for the public-state comparison below (#225) — this
    // never leaves the browser; only `id` is sent in the request path.
    let importedCredentialJson: unknown = null;
    try {
      importedCredentialJson = JSON.parse(jsonInput.trim());
    } catch {
      importedCredentialJson = null;
    }
    setImportedSummary(extractImportedCredentialSummary(importedCredentialJson));

    setIsLoading(true);
    try {
      const response = await apiClient<VerifyProofResponse>({
        path: `/proofs/${encodeURIComponent(id)}/verify`,
      });
      setResult(response);
    } catch {
      setError("Verification request failed. Check the credential and API URL.");
    } finally {
      setIsLoading(false);
      clearSelectedFile();
    }
  }

  function onCancel() {
    setJsonInput("");
    setResult(null);
    setImportedSummary(null);
    setError(null);
    clearSelectedFile();
  }

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-[18px] rounded-lg border border-white/10 bg-white/[0.04] p-5 sm:p-6"
        onSubmit={onSubmit}
      >
        <div>
          <h2 className="text-2xl font-semibold leading-8">Upload credential</h2>
          <p className="mt-2 text-sm leading-5 text-slate-300">
            Files are processed for verification and are not retained by this page.
          </p>
        </div>

        {/* Credential JSON input */}
        <div className="grid gap-[7px]">
          <label
            className="text-xs font-semibold text-slate-300"
            htmlFor="credential-json"
          >
            Credential JSON
          </label>
          <input
            className="h-[46px] rounded-lg border border-white/15 bg-transparent px-3 text-sm font-normal text-white placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            id="credential-json"
            onChange={(e) => {
              setJsonInput(e.target.value);
              setError(null);
              clearSelectedFile();
            }}
            placeholder="Paste a signed credential"
            type="text"
            value={jsonInput}
          />

          {/* Drag-and-drop / file-picker import. The file input is nested
              inside the zone, so its own click event bubbles back up to
              this div — guard onClick to only react to clicks that didn't
              originate on the input itself (or its remove button), or
              `openFilePicker` would call `.click()` on a click it just
              caused, and so on. */}
          <div
            aria-label="Drop a credential .json file here, or press Enter to browse for one"
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
              isDraggingOver
                ? "border-cyan-300 bg-cyan-300/10 text-cyan-100"
                : "border-white/20 text-slate-300 hover:border-white/40"
            }`}
            onClick={(clickEvent) => {
              if (clickEvent.target === fileInputRef.current) return;
              openFilePicker();
            }}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onKeyDown={handleDropZoneKeyDown}
            ref={dropZoneRef}
            role="button"
            tabIndex={0}
          >
            <span>
              Drag and drop a <span className="font-medium text-white">.json</span> credential
              file here, or{" "}
              <span className="text-cyan-200 underline underline-offset-2">browse</span>
            </span>
            <input
              accept=".json,application/json"
              aria-label="Upload credential JSON file"
              className="sr-only"
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
            {fileName ? (
              <span className="mt-1 flex items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-slate-200">
                {formatMessage(messages.fileNameLabel, { name: fileName })}
                <button
                  aria-label={formatMessage(messages.removeFileLabel, { name: fileName })}
                  className="text-slate-400 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    setJsonInput("");
                    clearSelectedFile();
                  }}
                  type="button"
                >
                  &times;
                </button>
              </span>
            ) : null}
          </div>
        </div>

        {/* Network — disabled, mirrors VerifyProofForm's "Verification method" */}
        <label className="grid gap-[7px] text-xs font-semibold text-slate-300">
          Network
          <input
            className="h-[46px] rounded-lg border border-white/15 bg-transparent px-3 text-sm font-normal text-slate-400"
            disabled
            value="Stellar Testnet"
          />
        </label>

        {/* Privacy info box — same copy and style as VerifyProofForm */}
        <div className="rounded-lg border border-cyan-300/50 bg-cyan-300/10 p-3 text-sm leading-5">
          <p className="font-medium text-cyan-200">Privacy protected</p>
          <p className="mt-1.5 text-slate-300">
            Only the fields shown in the disclosure summary can be shared.
          </p>
        </div>

        {error ? (
          <p
            aria-live="assertive"
            className="text-sm text-rose-200 focus-visible:outline-none"
            id="verify-credential-error"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            aria-describedby={error ? "verify-credential-error" : undefined}
            className="h-11 rounded-lg bg-cyan-300 px-6 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:h-10"
            disabled={isLoading}
            type="submit"
          >
            {isLoading ? "Checking..." : "Validate credential"}
          </button>
          {jsonInput || fileName ? (
            <button
              className="h-11 rounded-lg border border-white/15 px-6 text-sm font-medium text-slate-300 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 sm:h-10"
              disabled={isLoading}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {isLoading ? <VerifyResultSkeleton /> : <VerificationPanel result={result} />}
      {!isLoading && result && (
        <CredentialPublicStateComparison
          imported={importedSummary}
          response={result}
          signatureResult={result.result}
        />
      )}
      {!isLoading && result?.proof && (
        <KeyLifecyclePanel outcome={discoverSigningKey(result.proof.type)} />
      )}
    </div>
  );
}
