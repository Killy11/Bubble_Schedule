// Shared by proxy.ts, API routes and server components. No server-only import,
// so it stays safe to import anywhere on the server.
export const SESSION_COOKIE_NAME = "__session";
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days (Firebase max is 14)
