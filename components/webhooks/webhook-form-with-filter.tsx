"use client";

import { useCallback, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { createWebhook, type CreateWebhookResponse } from "@/lib/api/webhooks";
import {
  WEBHOOK_EVENT_TYPES,
  EVENT_TYPE_DESCRIPTIONS,
  type CreateWebhookInput,
} from "@/lib/validation/webhooks";
import { getSsrfGuidance, validateWebhookUrl } from "@/lib/validation/webhooks";
import { EventFilterBuilder } from "./event-filter-builder";
import type { WebhookEventFilter } from "@/lib/validation/webhook-filters";

export function WebhookFormWithFilter({
  token,
  onWebhookCreated,
}: {
  token: string;
  onWebhookCreated: (response: CreateWebhookResponse) => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WebhookEventFilter | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CreateWebhookInput>({
    defaultValues: {
      url: "",
      events: [],
    },
  });

  const selectedEvents = useWatch({ control, name: "events" }) || [];
  const urlValue = useWatch({ control, name: "url" }) || "";

  // Validate URL on change to show SSRF guidance
  const validateUrlField = useCallback(() => {
    if (!urlValue.trim()) {
      setUrlError(null);
      return;
    }

    const result = validateWebhookUrl(urlValue);
    if (!result.ok) {
      setUrlError(`${result.reason} - ${getSsrfGuidance()}`);
    } else {
      setUrlError(null);
    }
  }, [urlValue]);

  const onSubmit = useCallback(
    async (data: CreateWebhookInput) => {
      setIsSubmitting(true);
      setError(null);

      try {
        const controller = new AbortController();

        // Prepare request with filter if present
        const request = {
          url: data.url,
          events: data.events,
          ...(filter && { filter }),
        };

        const response = await createWebhook(token, request, controller.signal);
        onWebhookCreated(response);
        reset(); // Clear form after successful creation
        setUrlError(null);
        setFilter(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create webhook";
        setError(message || "Failed to create webhook. Please check your input and try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, onWebhookCreated, reset, filter]
  );

  return (
    <section className="grid gap-6">
      <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-5">
        <div>
          <h2 className="text-xl font-semibold text-white">Create Webhook Endpoint</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Register a new webhook endpoint to receive events when proofs are created, verified, or revoked.
            Your endpoint will receive signed requests that you can verify using the signing secret.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6">
          <div>
            <label htmlFor="webhook-url" className="block text-sm font-medium text-slate-200">
              Webhook URL
            </label>
            <input
              id="webhook-url"
              type="url"
              className={`mt-1 h-11 w-full rounded-md border px-4 text-white placeholder:text-slate-400 ${
                urlError
                  ? "border-rose-500 bg-rose-900/20"
                  : "border-white/10 bg-slate-900"
              }`}
              placeholder="https://example.com/webhooks/earnproof"
              {...register("url", {
                required: "Webhook URL is required",
                pattern: {
                  value: /^https:\/\//,
                  message: "Only HTTPS URLs are allowed (http:// is not supported)",
                },
              })}
              onBlur={validateUrlField}
              onChange={() => validateUrlField()}
            />
            {errors.url && (
              <p className="mt-1 text-xs text-rose-200" role="alert">
                {errors.url.message}
              </p>
            )}
            {urlError && (
              <div className="mt-2 rounded-md border border-amber-300/30 bg-amber-300/10 p-2">
                <p className="text-xs text-amber-200">{urlError}</p>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Must be HTTPS. Cannot target private IP ranges, localhost, or cloud metadata services.
              For testing, use webhook.site or a similar service.
            </p>
          </div>

          <div>
            <fieldset>
              <legend className="text-sm font-medium text-slate-200">
                Events to Subscribe (Select at least one)
              </legend>
              <p className="mt-1 text-xs text-slate-400">
                Choose which proof events you want to receive.
              </p>
              <div className="mt-3 grid gap-3">
                {WEBHOOK_EVENT_TYPES.map((event) => {
                  const isChecked = selectedEvents.includes(event);
                  const description = EVENT_TYPE_DESCRIPTIONS[event];

                  return (
                    <label
                      key={event}
                      className={`flex gap-3 rounded-md border p-3 cursor-pointer transition ${
                        isChecked
                          ? "border-cyan-300/50 bg-cyan-300/5"
                          : "border-white/10 bg-transparent hover:bg-white/[0.02]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        value={event}
                        checked={isChecked}
                        {...register("events", {
                          required: "At least one event is required",
                        })}
                        className="mt-1 h-4 w-4"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white">
                          {description.title}
                        </div>
                        <div className="mt-1 text-xs text-slate-300">
                          {description.description}
                        </div>
                        <div className="mt-1 text-xs text-slate-400 font-mono">
                          {event}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {errors.events && (
                <p className="mt-2 text-xs text-rose-200" role="alert">
                  {errors.events.message}
                </p>
              )}
            </fieldset>
          </div>

          {error && (
            <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
              <p className="text-sm text-rose-200" role="alert">
                {error}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || selectedEvents.length === 0}
            className="h-10 w-fit rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-cyan-200 transition"
          >
            {isSubmitting ? "Creating..." : "Create Webhook Endpoint"}
          </button>
        </form>
      </div>

      {/* Optional: Event Filter Builder */}
      <details className="group">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-300 hover:text-white transition">
          <span className="inline-block mr-2">→</span>
          Advanced: Add Event Filter (Optional)
        </summary>
        <div className="mt-4">
          <EventFilterBuilder
            initialFilter={filter || undefined}
            onFilterChange={setFilter}
            disabled={isSubmitting}
          />
          {filter && !Object.keys(filter.predicates).every((k) => !filter.predicates[k as any]) && (
            <div className="mt-3 text-xs text-slate-400">
              <p>✓ A filter has been configured and will be applied to this webhook.</p>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
