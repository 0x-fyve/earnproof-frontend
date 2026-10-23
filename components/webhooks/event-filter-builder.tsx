"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { WebhookEventFilter, WEBHOOK_EVENT_TYPES, WEBHOOK_OUTCOMES, WEBHOOK_RESOURCE_TYPES, EVENT_TYPE_DESCRIPTIONS, FILTER_LIMITS, isEmptyFilter, getOutcomeLabel, getResourceTypeLabel } from "@/lib/validation/webhook-filters";
import { validateFilter, normalizeFilter, serializeFilter, checkFilterBoundaryViolations, generateFilterSummary } from "@/lib/validation/webhook-filters.validation";
import type { FieldError } from "@/lib/validation/webhook-filters";

export type EventFilterBuilderProps = {
  initialFilter?: WebhookEventFilter;
  onFilterChange: (filter: WebhookEventFilter) => void;
  disabled?: boolean;
  isLoading?: boolean;
};

export function EventFilterBuilder({
  initialFilter,
  onFilterChange,
  disabled = false,
  isLoading = false,
}: EventFilterBuilderProps) {
  const [filter, setFilter] = useState<WebhookEventFilter>(
    initialFilter || { version: 1, predicates: {} }
  );
  const [validationErrors, setValidationErrors] = useState<FieldError[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "json">("summary");
  const previewRef = useRef<HTMLDivElement>(null);

  // Validate filter whenever it changes
  useEffect(() => {
    const validationResult = validateFilter(filter);
    if (!validationResult.ok) {
      setValidationErrors(validationResult.errors);
    } else {
      setValidationErrors([]);
    }
  }, [filter]);

  // Notify parent of changes
  const handleFilterChange = useCallback(
    (newFilter: WebhookEventFilter) => {
      setFilter(newFilter);
      setIsDirty(true);
      onFilterChange(newFilter);
    },
    [onFilterChange]
  );

  // Get error for a specific field
  const getFieldError = (fieldPath: string): string | null => {
    const error = validationErrors.find((e) => e.path === fieldPath);
    return error?.message || null;
  };

  // Update event predicate
  const handleEventChange = useCallback(
    (events: string[]) => {
      const newFilter = { ...filter };
      if (events.length === 0) {
        delete newFilter.predicates.event;
      } else {
        newFilter.predicates.event = { allowedEvents: events as any };
      }
      handleFilterChange(newFilter);
    },
    [filter, handleFilterChange]
  );

  // Update resource predicate
  const handleResourceTypeChange = useCallback(
    (resourceType: string) => {
      const newFilter = { ...filter };
      if (!resourceType) {
        delete newFilter.predicates.resource;
      } else {
        newFilter.predicates.resource = {
          resourceType: resourceType as any,
          ...(filter.predicates.resource?.resourceIds && {
            resourceIds: filter.predicates.resource.resourceIds,
          }),
        };
      }
      handleFilterChange(newFilter);
    },
    [filter, handleFilterChange]
  );

  const handleResourceIdsChange = useCallback(
    (ids: string[]) => {
      const newFilter = { ...filter };
      if (!newFilter.predicates.resource) return;
      if (ids.length === 0) {
        delete newFilter.predicates.resource.resourceIds;
      } else {
        newFilter.predicates.resource.resourceIds = ids;
      }
      handleFilterChange(newFilter);
    },
    [filter, handleFilterChange]
  );

  // Update outcome predicate
  const handleOutcomeChange = useCallback(
    (outcomes: string[]) => {
      const newFilter = { ...filter };
      if (outcomes.length === 0) {
        delete newFilter.predicates.outcome;
      } else {
        newFilter.predicates.outcome = { outcomes: outcomes as any };
      }
      handleFilterChange(newFilter);
    },
    [filter, handleFilterChange]
  );

  // Update version predicate
  const handleVersionChange = useCallback(
    (versions: string[]) => {
      const newFilter = { ...filter };
      if (versions.length === 0) {
        delete newFilter.predicates.version;
      } else {
        newFilter.predicates.version = { versions };
      }
      handleFilterChange(newFilter);
    },
    [filter, handleFilterChange]
  );

  // Check boundary violations
  const boundaryViolation = checkFilterBoundaryViolations(filter);

  // Generate preview
  const preview = generateFilterSummary(filter);
  const normalizedJson = serializeFilter(normalizeFilter(filter));
  const isEmpty = isEmptyFilter(filter);
  const isValid = validationErrors.length === 0 && !boundaryViolation;

  return (
    <div className="grid gap-6 rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Event Filter (Optional)</h2>
        <p className="mt-1 text-sm text-slate-400">
          Define specific conditions for which events you want to receive. Leave empty to receive all events.
        </p>
      </div>

      {/* Event Predicate */}
      <div className="grid gap-3">
        <fieldset>
          <legend className="text-sm font-medium text-slate-200">
            Event Types {filter.predicates.event && <span className="text-cyan-300">({filter.predicates.event.allowedEvents.length})</span>}
          </legend>
          <p className="mt-1 text-xs text-slate-400">Select which proof events to receive</p>
          <div className="mt-3 grid gap-2">
            {WEBHOOK_EVENT_TYPES.map((event) => {
              const isChecked = filter.predicates.event?.allowedEvents.includes(event) || false;
              const description = EVENT_TYPE_DESCRIPTIONS[event];

              return (
                <label
                  key={event}
                  className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${
                    isChecked
                      ? "border-cyan-300/50 bg-cyan-300/5"
                      : "border-white/10 bg-transparent hover:bg-white/[0.02]"
                  } ${disabled || isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleEventChange([
                          ...(filter.predicates.event?.allowedEvents || []),
                          event,
                        ]);
                      } else {
                        handleEventChange(
                          filter.predicates.event?.allowedEvents.filter((e) => e !== event) || []
                        );
                      }
                    }}
                    disabled={disabled || isLoading}
                    className="mt-1 h-4 w-4"
                    aria-label={`Subscribe to ${description.title} events`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{description.title}</div>
                    <div className="mt-1 text-xs text-slate-400">{description.description}</div>
                    <div className="mt-1 text-xs text-slate-500 font-mono">{event}</div>
                  </div>
                </label>
              );
            })}
          </div>
          {getFieldError("predicates.event.allowedEvents") && (
            <p className="mt-2 text-xs text-rose-200" role="alert">
              {getFieldError("predicates.event.allowedEvents")}
            </p>
          )}
        </fieldset>
      </div>

      {/* Resource Predicate */}
      <div className="grid gap-3">
        <fieldset>
          <legend className="text-sm font-medium text-slate-200">Resource (Optional)</legend>
          <p className="mt-1 text-xs text-slate-400">Filter by resource type or specific resource IDs</p>

          <div className="mt-3 grid gap-3">
            {/* Resource Type Dropdown */}
            <div>
              <label htmlFor="resource-type" className="text-xs font-medium text-slate-300">
                Resource Type
              </label>
              <select
                id="resource-type"
                value={filter.predicates.resource?.resourceType || ""}
                onChange={(e) => handleResourceTypeChange(e.target.value)}
                disabled={disabled || isLoading}
                className="mt-1 h-9 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-white"
                aria-label="Select resource type to filter by"
              >
                <option value="">-- No resource filter --</option>
                {WEBHOOK_RESOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {getResourceTypeLabel(type)}
                  </option>
                ))}
              </select>
            </div>

            {/* Resource IDs Input */}
            {filter.predicates.resource && (
              <div>
                <label htmlFor="resource-ids" className="text-xs font-medium text-slate-300">
                  Resource IDs (Optional, comma-separated)
                </label>
                <textarea
                  id="resource-ids"
                  value={filter.predicates.resource.resourceIds?.join(", ") || ""}
                  onChange={(e) => {
                    const ids = e.target.value
                      .split(",")
                      .map((id) => id.trim())
                      .filter((id) => id.length > 0);
                    handleResourceIdsChange(ids);
                  }}
                  disabled={disabled || isLoading}
                  placeholder="e.g., proof_123, proof_456"
                  className="mt-1 h-20 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  aria-label="Enter resource IDs separated by commas"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Leave empty to match any {filter.predicates.resource.resourceType}
                </p>
              </div>
            )}
          </div>

          {getFieldError("predicates.resource.resourceType") && (
            <p className="mt-2 text-xs text-rose-200" role="alert">
              {getFieldError("predicates.resource.resourceType")}
            </p>
          )}
          {getFieldError("predicates.resource.resourceIds") && (
            <p className="mt-2 text-xs text-rose-200" role="alert">
              {getFieldError("predicates.resource.resourceIds")}
            </p>
          )}
        </fieldset>
      </div>

      {/* Outcome Predicate */}
      <div className="grid gap-3">
        <fieldset>
          <legend className="text-sm font-medium text-slate-200">
            Outcome {filter.predicates.outcome && <span className="text-cyan-300">({filter.predicates.outcome.outcomes.length})</span>}
          </legend>
          <p className="mt-1 text-xs text-slate-400">Filter by proof verification outcome</p>
          <div className="mt-3 grid gap-2">
            {WEBHOOK_OUTCOMES.map((outcome) => {
              const isChecked = filter.predicates.outcome?.outcomes.includes(outcome) || false;

              return (
                <label
                  key={outcome}
                  className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${
                    isChecked
                      ? "border-cyan-300/50 bg-cyan-300/5"
                      : "border-white/10 bg-transparent hover:bg-white/[0.02]"
                  } ${disabled || isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleOutcomeChange([
                          ...(filter.predicates.outcome?.outcomes || []),
                          outcome,
                        ]);
                      } else {
                        handleOutcomeChange(
                          filter.predicates.outcome?.outcomes.filter((o) => o !== outcome) || []
                        );
                      }
                    }}
                    disabled={disabled || isLoading}
                    className="mt-1 h-4 w-4"
                    aria-label={`Filter by ${getOutcomeLabel(outcome)} outcomes`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">
                      {getOutcomeLabel(outcome)}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          {getFieldError("predicates.outcome.outcomes") && (
            <p className="mt-2 text-xs text-rose-200" role="alert">
              {getFieldError("predicates.outcome.outcomes")}
            </p>
          )}
        </fieldset>
      </div>

      {/* Version Predicate */}
      <div className="grid gap-3">
        <div>
          <label htmlFor="versions" className="text-sm font-medium text-slate-200">
            API Versions (Optional) {filter.predicates.version && <span className="text-cyan-300">({filter.predicates.version.versions.length})</span>}
          </label>
          <p className="mt-1 text-xs text-slate-400">
            Filter by API/schema version (e.g., 1.0, 2.0, comma-separated)
          </p>
          <textarea
            id="versions"
            value={filter.predicates.version?.versions.join(", ") || ""}
            onChange={(e) => {
              const versions = e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter((v) => v.length > 0);
              handleVersionChange(versions);
            }}
            disabled={disabled || isLoading}
            placeholder="e.g., 1.0, 2.0, 2.1"
            className="mt-2 h-20 w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500"
            aria-label="Enter API versions separated by commas"
          />
          {getFieldError("predicates.version.versions") && (
            <p className="mt-2 text-xs text-rose-200" role="alert">
              {getFieldError("predicates.version.versions")}
            </p>
          )}
        </div>
      </div>

      {/* Error Display */}
      {validationErrors.length > 0 && !boundaryViolation && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {validationErrors.length} validation error{validationErrors.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      {boundaryViolation && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {boundaryViolation}
          </p>
        </div>
      )}

      {/* Preview Section */}
      <div ref={previewRef} className="grid gap-3 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <div className="flex gap-2 border-b border-white/10">
          <button
            onClick={() => setActiveTab("summary")}
            className={`px-3 py-2 text-sm font-medium transition ${
              activeTab === "summary"
                ? "border-b-2 border-cyan-300 text-cyan-300"
                : "text-slate-400 hover:text-slate-300"
            }`}
            aria-selected={activeTab === "summary"}
            role="tab"
          >
            Summary
          </button>
          <button
            onClick={() => setActiveTab("json")}
            className={`px-3 py-2 text-sm font-medium transition ${
              activeTab === "json"
                ? "border-b-2 border-cyan-300 text-cyan-300"
                : "text-slate-400 hover:text-slate-300"
            }`}
            aria-selected={activeTab === "json"}
            role="tab"
          >
            JSON Preview
          </button>
        </div>

        {activeTab === "summary" && (
          <div className="text-sm">
            <p className="text-slate-300">{preview}</p>
            {isEmpty && (
              <p className="mt-2 text-xs text-slate-500">
                ℹ️ No filter means this webhook will receive all events.
              </p>
            )}
          </div>
        )}

        {activeTab === "json" && (
          <div className="overflow-x-auto">
            <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words">
              {normalizedJson}
            </pre>
          </div>
        )}
      </div>

      {/* Boundary Warning */}
      {filter.predicates.event && filter.predicates.event.allowedEvents.length > FILTER_LIMITS.MAX_VALUES_PER_PREDICATE - 10 && (
        <div className="rounded-md border border-amber-300/30 bg-amber-300/10 p-3">
          <p className="text-xs text-amber-200">
            ⚠️ Approaching event limit: {filter.predicates.event.allowedEvents.length}/{FILTER_LIMITS.MAX_VALUES_PER_PREDICATE}
          </p>
        </div>
      )}

      {/* Status Summary */}
      <div className="flex items-center justify-between text-xs">
        <div>
          {isValid ? (
            <p className="text-emerald-300">✓ Filter is valid</p>
          ) : (
            <p className="text-rose-200">✕ Filter has errors</p>
          )}
        </div>
        {isDirty && <p className="text-amber-300">Unsaved changes</p>}
      </div>
    </div>
  );
}
