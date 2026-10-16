"use client";

import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { updateOrganizationSafe } from "@/lib/api/organizations";
import { updateOrganizationSchema, type UpdateOrganizationInput } from "@/lib/validation/organizations";
import { isValidationError, isConflictError, isRetryableError, formatFieldErrors } from "@/lib/api/error-normalization";
import type { Organization } from "@/lib/api/generated/v1";

export function OrganizationEditForm({
  organization,
  token,
  onOrganizationUpdated,
  onCancel,
}: {
  organization: Organization;
  token: string;
  onOrganizationUpdated: (organization: Organization) => void;
  onCancel: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryableError, setRetryableError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    setError,
    reset,
  } = useForm<UpdateOrganizationInput>({
    defaultValues: {
      name: organization.name,
      website: organization.website || "",
    },
  });

  const onSubmit = useCallback(async (data: UpdateOrganizationInput) => {
    setIsSubmitting(true);
    setFormError(null);
    setRetryableError(null);

    try {
      // Validate with Zod schema
      const validationResult = await updateOrganizationSchema.safeParseAsync(data);
      if (!validationResult.success) {
        const formatted = formatFieldErrors(
          Object.fromEntries(
            validationResult.error.issues.map((err: { path: (string | number)[]; message: string }) => [
              err.path.join("."),
              err.message,
            ])
          )
        );
        for (const [field, message] of Object.entries(formatted)) {
          setError(field as keyof UpdateOrganizationInput, {
            type: "validate",
            message: typeof message === "string" ? message : "Invalid field",
          });
        }
        return;
      }

      const controller = new AbortController();
      const result = await updateOrganizationSafe(
        token,
        organization.id,
        data,
        controller.signal
      );

      if (result.success) {
        // Cache refresh on successful write
        onOrganizationUpdated(result.data);
        reset();
      } else {
        const { error } = result;

        // Handle field-level validation errors
        if (isValidationError(error)) {
          const formatted = formatFieldErrors(error.fieldErrors);
          for (const [field, message] of Object.entries(formatted)) {
            setError(field as keyof UpdateOrganizationInput, {
              type: "server",
              message: typeof message === "string" ? message : "Invalid field",
            });
          }
          // Show form-level message if no field errors
          if (Object.keys(formatted).length === 0) {
            setFormError(error.message);
          }
        }
        // Handle conflict errors (concurrent edits)
        else if (isConflictError(error)) {
          setFormError(error.message);
          setRetryableError(
            "Refresh the page to see the latest version and try again."
          );
        }
        // Handle retryable network errors
        else if (isRetryableError(error)) {
          setFormError(error.message);
          setRetryableError("Please check your connection and try again.");
        }
        // Handle other errors
        else {
          setFormError(error.message);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [token, organization.id, onOrganizationUpdated, reset, setError]);

  const handleRetry = useCallback(() => {
    setFormError(null);
    setRetryableError(null);
    void handleSubmit(onSubmit)();
  }, [handleSubmit, onSubmit]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6">
      {/* Name field */}
      <div>
        <label htmlFor="edit-org-name" className="block text-sm font-medium text-slate-200">
          Organization Name
        </label>
        <input
          id="edit-org-name"
          type="text"
          className={`mt-1 h-11 w-full rounded-md border px-4 text-white placeholder:text-slate-400 ${
            errors.name
              ? "border-rose-300/50 bg-rose-950/20"
              : "border-white/10 bg-slate-900"
          }`}
          placeholder="Organization name"
          disabled={isSubmitting}
          {...register("name")}
        />
        {errors.name && (
          <p className="mt-1 text-xs text-rose-200" role="alert">
            {errors.name.message}
          </p>
        )}
      </div>

      {/* Website field */}
      <div>
        <label htmlFor="edit-org-website" className="block text-sm font-medium text-slate-200">
          Website (Optional)
        </label>
        <input
          id="edit-org-website"
          type="url"
          className={`mt-1 h-11 w-full rounded-md border px-4 text-white placeholder:text-slate-400 ${
            errors.website
              ? "border-rose-300/50 bg-rose-950/20"
              : "border-white/10 bg-slate-900"
          }`}
          placeholder="https://example.com"
          disabled={isSubmitting}
          {...register("website")}
        />
        {errors.website && (
          <p className="mt-1 text-xs text-rose-200" role="alert">
            {errors.website.message}
          </p>
        )}
      </div>

      {/* Form-level error with retry option */}
      {formError && (
        <div className="rounded-md border border-rose-300/30 bg-rose-300/10 p-3">
          <p className="text-sm text-rose-200" role="alert">
            {formError}
          </p>
          {retryableError && (
            <>
              <p className="mt-1 text-xs text-rose-200/80">
                {retryableError}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                disabled={isSubmitting}
                className="mt-2 inline-flex h-8 items-center rounded border border-rose-300/30 px-3 text-xs font-medium text-rose-200 hover:bg-rose-300/10 disabled:opacity-50 transition"
              >
                {isSubmitting ? "Retrying..." : "Retry"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isSubmitting || !isDirty}
          className="h-10 rounded-md bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-cyan-200 transition"
        >
          {isSubmitting ? "Saving..." : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="h-10 rounded-md border border-white/15 px-4 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10 transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
