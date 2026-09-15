/**
 * Elysia plugin wiring the shared brain endpoints + the ACCESS_TOKEN gate.
 * Mount with .use(brainRoutes(tracker)) — one tracker per brain, over the brain's own sqlite.
 */

import { Elysia } from "elysia";
import type { Tracker } from "./track";
import { isMe, keyOk, tokenCookie, tokenOk } from "./gate";

export function brainRoutes(tracker: Tracker) {
  return new Elysia({ name: "company-brain" })
    .onBeforeHandle(({ request, set }) => {
      if (!tokenOk(request)) return new Response("Unauthorized", { status: 401 });
      const stamp = tokenCookie(request);
      if (stamp) set.headers["set-cookie"] = stamp;
    })
    .get("/healthz", () => ({ ok: true }))
    .get("/activity", ({ request }) => {
      if (!keyOk(request)) return new Response("Unauthorized", { status: 401 });
      return Response.json(tracker.snapshot());
    })
    .post("/activity/reset", ({ request }) => {
      if (!keyOk(request)) return new Response("Unauthorized", { status: 401 });
      tracker.clear();
      return { ok: true };
    })
    .post("/track", async ({ request }) => {
      if (isMe(request)) return new Response(null, { status: 204 });
      const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (b?.kind === "scroll") tracker.track("scroll", { depth: Math.max(0, Math.min(100, Number(b.depth) || 0)) });
      else if (b?.kind === "click") tracker.track("click", { t: String(b.t ?? "").slice(0, 60) });
      else if (b?.kind === "dwell") tracker.track("dwell", { secs: Math.max(0, Math.min(86400, Number(b.secs) || 0)) });
      return new Response(null, { status: 204 });
    });
}
