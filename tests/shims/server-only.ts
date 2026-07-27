// No-op shim for `server-only` when running tests outside of Next.js.
// In Next, this package throws if imported into a client bundle; under
// Vitest it's safe to ignore.
export {};