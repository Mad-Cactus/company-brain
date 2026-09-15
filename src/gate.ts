/**
 * Gates shared by all company brains:
 * - ACTIVITY_KEY: gates /activity (the Mad Cactus CRM pull). Visiting /?key=<KEY>
 *   also marks the browser as Collin's (me-cookie) so his own views never count.
 * - OWNER_SECRET: zero-step self-exclusion — the Mad Cactus dashboard sets a
 *   signed cookie on .madcactus.org at login; brains verify the HMAC and skip
 *   tracking. Off until OWNER_SECRET is set on both sides.
 * - ACCESS_TOKEN: demo gate — when set, every route needs ?token= or the
 *   cookie it stamps. Unset = open (local dev). /healthz stays open.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const cookieList = (request: Request) => (request.headers.get("cookie") || "").split(/;\s*/);

export function ownerCookieOk(request: Request): boolean {
  const secret = process.env.OWNER_SECRET || "";
  if (!secret) return false;
  const raw = cookieList(request).find((c) => c.startsWith("mc_owner="));
  if (!raw) return false;
  const [exp, sig] = raw.slice("mc_owner=".length).split(".");
  const expN = Number(exp);
  if (!exp || !sig || !Number.isFinite(expN) || expN < Date.now()) return false;
  const expect = createHmac("sha256", secret).update(String(exp)).digest("hex");
  if (sig.length !== expect.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch {
    return false;
  }
}

/** Legacy me-cookie (?me=1 stamps `me=1`) + the signed dashboard cookie both count as self. */
export const isMe = (request: Request) => cookieList(request).includes("me=1") || ownerCookieOk(request);

export const keyOk = (request: Request) =>
  (process.env.ACTIVITY_KEY || "") !== "" &&
  (new URL(request.url).searchParams.get("key") === process.env.ACTIVITY_KEY ||
    request.headers.get("x-activity-key") === process.env.ACTIVITY_KEY);

/** demo gate: ACCESS_TOKEN set => every route needs ?token= or the cookie it stamps. /healthz exempt. */
export const tokenOk = (request: Request) => {
  const token = process.env.ACCESS_TOKEN || "";
  const url = new URL(request.url);
  if (url.pathname === "/healthz" || !token) return true;
  if (url.searchParams.get("token") === token) return true;
  return cookieList(request).includes(`demo_token=${token}`);
};

/** Cookie to stamp when a request arrives with a valid ?token= (empty string = don't). */
export const tokenCookie = (request: Request) => {
  const token = process.env.ACCESS_TOKEN || "";
  return token && new URL(request.url).searchParams.get("token") === token
    ? `demo_token=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`
    : "";
};

/** The `/` preamble every brain repeats: decide the me-cookie + demo flag.
 * Visits are NOT counted here — server-side GET tracking logged every
 * scanner/bot hit (all 32 recorded koola visits were bots). The visit comes
 * from the page's JS beacon via POST /track, where a UA denylist blocks
 * headless browsers that run JS. Call once at the top of the `/` handler. */
export function handleVisit(request: Request): { demo: boolean; meCookie: string } {
  const url = new URL(request.url);
  // ?demo=1: normal page for screenshares, but nothing is tracked and no
  // beacons are injected — metrics stay pure.
  const demo = url.searchParams.has("demo");
  const self = isMe(request);
  const meCookie =
    !demo && !self && (url.searchParams.has("me") || keyOk(request))
      ? "me=1; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax"
      : "";
  return { demo, meCookie };
}
