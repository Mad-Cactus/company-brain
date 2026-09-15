/** Minimal logger — server-side detail only; never returned to clients. */

const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (msg: string, ...extra: unknown[]) => console.log(`[${ts()}] ℹ ${msg}`, ...extra),
  warn: (msg: string, ...extra: unknown[]) => console.warn(`[${ts()}] ⚠ ${msg}`, ...extra),
  error: (msg: string, ...extra: unknown[]) => console.error(`[${ts()}] ✖ ${msg}`, ...extra),
};
