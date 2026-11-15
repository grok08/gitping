/**
 * Origins allowed to call the API from a browser.
 *
 * HTTP uses this list through CORS. The WebSocket upgrade cannot use CORS, so
 * the realtime route checks the same list against the `Origin` header before
 * upgrading.
 */
export const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

/**
 * A missing header is allowed: non-browser clients (tests, scripts) do not
 * send one, and there are no credentials to steal from them.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }

  return allowedOrigins.includes(origin);
}
