const requestIdPattern = /^[A-Za-z0-9_-]{8,64}$/;

export const requestIdError =
  "requestId must be 8 to 64 characters of A-Z, a-z, 0-9, _ or -";

export type RequestIdCheck =
  | { ok: true; requestId: string | undefined }
  | { ok: false };

/**
 * `requestId` is optional. When it is present it must be a stable name for one
 * intent, so anything outside the allowed characters or length is rejected
 * before the service sees it.
 */
export function checkRequestId(value: unknown): RequestIdCheck {
  if (value === undefined || value === null) {
    return { ok: true, requestId: undefined };
  }

  if (typeof value !== "string" || !requestIdPattern.test(value)) {
    return { ok: false };
  }

  return { ok: true, requestId: value };
}
