import { apiClient, bearer, retryRead, retryMutation } from "./client";
import type { WebhookEventFilter } from "@/lib/validation/webhook-filters";

export type CreateWebhookRequest = {
  url: string;
  events: string[]; // Legacy: still supported
  filter?: WebhookEventFilter | null; // New: optional, overrides events
};

export type Webhook = {
  id: string;
  url: string;
  events: string[]; // For compatibility
  filter?: WebhookEventFilter | null;
  filterVersion?: string; // Etag-like for conflict detection
  status: "ACTIVE" | "DISABLED";
};

export type CreateWebhookResponse = {
  webhook: Webhook;
  secret: string; // Only returned once on creation
};

export type RotateWebhookResponse = {
  webhook: Webhook;
  secret: string; // Only returned once on rotation
};

export type WebhookDelivery = {
  id: string;
  webhookId: string;
  eventType: string;
  status: "PENDING" | "SUCCESS" | "FAILED" | "RETRYING";
  statusCode?: number;
  attemptCount: number;
  createdAt: string;
  deliveredAt?: string;
  nextRetryAt?: string;
};

export type ListDeliveriesResponse = {
  deliveries: WebhookDelivery[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type UpdateWebhookRequest = {
  url?: string;
  events?: string[]; // Legacy
  filter?: WebhookEventFilter | null; // New: optional
  status?: "ACTIVE" | "DISABLED";
  filterVersion?: string; // For optimistic concurrency control
};

export type FilterPreviewResponse = {
  matchedEventTypes: string[];
  normalizedFilter: WebhookEventFilter;
};

export type ValidateFilterResourcesResponse = {
  valid: boolean;
  invalidResourceIds?: string[];
};

export async function createWebhook(
  token: string,
  request: CreateWebhookRequest,
  signal: AbortSignal
): Promise<CreateWebhookResponse> {
  return retryMutation(async (signal) => {
    return apiClient<CreateWebhookResponse>({
      path: "/webhooks",
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
  }, signal);
}

export async function getWebhooks(token: string, signal: AbortSignal): Promise<Webhook[]> {
  return retryRead(async (signal) => {
    return apiClient<Webhook[]>({
      path: "/webhooks",
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function getWebhook(
  token: string,
  webhookId: string,
  signal: AbortSignal
): Promise<Webhook> {
  return retryRead(async (signal) => {
    return apiClient<Webhook>({
      path: `/webhooks/${webhookId}`,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function updateWebhook(
  token: string,
  webhookId: string,
  request: UpdateWebhookRequest,
  signal: AbortSignal
): Promise<Webhook> {
  return retryMutation(async (signal) => {
    return apiClient<Webhook>({
      path: `/webhooks/${webhookId}`,
      method: "PATCH",
      headers: bearer(token),
      body: JSON.stringify(request),
      signal,
    });
  }, signal);
}

export async function deleteWebhook(
  token: string,
  webhookId: string,
  signal: AbortSignal
): Promise<void> {
  return retryMutation(async (signal) => {
    await apiClient({
      path: `/webhooks/${webhookId}`,
      method: "DELETE",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function rotateWebhook(
  token: string,
  webhookId: string,
  signal: AbortSignal
): Promise<RotateWebhookResponse> {
  return retryMutation(async (signal) => {
    return apiClient<RotateWebhookResponse>({
      path: `/webhooks/${webhookId}/rotate`,
      method: "POST",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function replayWebhookDelivery(
  token: string,
  webhookId: string,
  deliveryId: string,
  signal: AbortSignal
): Promise<WebhookDelivery> {
  return retryMutation(async (signal) => {
    return apiClient<WebhookDelivery>({
      path: `/webhooks/${webhookId}/deliveries/${deliveryId}/replay`,
      method: "POST",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

export async function listWebhookDeliveries(
  token: string,
  webhookId: string,
  options: {
    page?: number;
    pageSize?: number;
    status?: string;
    eventType?: string;
  },
  signal: AbortSignal
): Promise<ListDeliveriesResponse> {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set("page", String(options.page));
  if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
  if (options.status) params.set("status", options.status);
  if (options.eventType) params.set("eventType", options.eventType);

  const queryString = params.toString();
  const path = `/webhooks/${webhookId}/deliveries${queryString ? `?${queryString}` : ""}`;

  return retryRead(async (signal) => {
    return apiClient<ListDeliveriesResponse>({
      path,
      method: "GET",
      headers: bearer(token),
      signal,
    });
  }, signal);
}

/**
 * Validate filter resource IDs against current tenant
 * Returns only invalid IDs, never revealing existence of valid ones (security)
 */
export async function validateFilterResources(
  token: string,
  resourceIds: string[],
  signal: AbortSignal
): Promise<ValidateFilterResourcesResponse> {
  return retryRead(async (signal) => {
    return apiClient<ValidateFilterResourcesResponse>({
      path: "/webhooks/validate-filter-resources",
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ resourceIds }),
      signal,
    });
  }, signal);
}

/**
 * Preview which events would match a filter (optional backend feature)
 * Does not send real events, only returns a prediction
 */
export async function previewFilterMatches(
  token: string,
  filter: WebhookEventFilter,
  signal: AbortSignal
): Promise<FilterPreviewResponse> {
  return retryRead(async (signal) => {
    return apiClient<FilterPreviewResponse>({
      path: "/webhooks/preview-filter",
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ filter }),
      signal,
    });
  }, signal);
}

export function enableWebhook(
  token: string,
  webhookId: string,
  signal: AbortSignal
): Promise<Webhook> {
  return updateWebhook(token, webhookId, { status: "ACTIVE" }, signal);
}

export function disableWebhook(
  token: string,
  webhookId: string,
  signal: AbortSignal
): Promise<Webhook> {
  return updateWebhook(token, webhookId, { status: "DISABLED" }, signal);
}

export function formatWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

export function formatDeliveryTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

export function getDeliveryStatusBadgeColor(
  status: string
): "green" | "yellow" | "red" | "blue" | "gray" {
  switch (status) {
    case "SUCCESS":
      return "green";
    case "FAILED":
      return "red";
    case "RETRYING":
      return "yellow";
    case "PENDING":
      return "blue";
    default:
      return "gray";
  }
}

export function getDeliveryStatusLabel(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "Delivered";
    case "FAILED":
      return "Failed";
    case "RETRYING":
      return "Retrying";
    case "PENDING":
      return "Pending";
    default:
      return status;
  }
}
