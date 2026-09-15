/**
 * Package self-check: tracker math, timestamp Z-tag, gates, and the mounted routes.
 * Run: bun test src/self-check.test.ts
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createHmac } from "node:crypto";
import { openSqlite, ensureEventsTable, createTracker, ownerCookieOk, isMe, keyOk, tokenOk, tokenCookie, handleVisit, brainRoutes, BOT_UA } from "./index";

process.env.DATABASE_PATH = "/tmp/company-brain-selfcheck.db";
const sqlite = openSqlite(process.env.DATABASE_PATH);
ensureEventsTable(sqlite);
const tracker = createTracker(sqlite);

const ENV_KEYS = ["ACTIVITY_KEY", "OWNER_SECRET", "ACCESS_TOKEN"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterAll(() => { for (const k of ENV_KEYS) if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]!; });
beforeEach(() => { for (const k of ENV_KEYS) delete process.env[k]; sqlite.exec("delete from events"); });

const req = (path: string, headers: Record<string, string> = {}) => new Request(`http://brain.test${path}`, { headers });
const mintOwner = (secret: string, exp = Date.now() + 60_000) => {
  const sig = createHmac("sha256", secret).update(String(exp)).digest("hex");
  return `mc_owner=${exp}.${sig}`;
};

describe("tracker", () => {
  test("snapshot emits ISO-UTC timestamps and dedupes tool names", () => {
    tracker.track("visit", { host: "t.local" });
    tracker.track("mcp_tool", { tool: "shippers" });
    tracker.track("mcp_tool", { tool: "shippers" });
    const a = tracker.snapshot();
    expect(a.visits).toBe(1);
    expect(a.toolCalls).toBe(2);
    expect(a.lastVisit).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(new Date(a.lastVisit!).getTime()).not.toBeNaN();
    expect(a.tools).toEqual(["shippers×2"]);
    tracker.clear();
    expect(tracker.snapshot().visits).toBe(0);
  });

  test("trackMcp maps initialize/tools/call", () => {
    tracker.trackMcp({ method: "initialize", params: { clientInfo: { name: "Claude" } } });
    tracker.trackMcp({ method: "tools/call", params: { name: "shipper_detail" } });
    const a = tracker.snapshot();
    expect(a.agent).toBe("Claude");
    expect(a.toolCalls).toBe(1);
    expect(a.tools).toEqual(["shipper_detail"]);
  });

  test("scroll clamps into /track handler (depth 150 -> 100)", async () => {
    const app = new Elysia().use(brainRoutes(tracker));
    await app.handle(new Request("http://b.test/track", { method: "POST", body: JSON.stringify({ kind: "scroll", depth: 150 }) }));
    expect(tracker.snapshot().maxDepth).toBe(100);
  });

  test("visit comes from the JS beacon: human UA counts, bot UA is denied", async () => {
    const app = new Elysia().use(brainRoutes(tracker));
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
    await app.handle(new Request("http://b.test/track", { method: "POST", headers: { "user-agent": chrome }, body: JSON.stringify({ kind: "visit", host: "koola.madcactus.org" }) }));
    await app.handle(new Request("http://b.test/track", { method: "POST", headers: { "user-agent": "Mozilla/5.0 (compatible; CensysInspect/1.1)" }, body: JSON.stringify({ kind: "visit", host: "koola.madcactus.org" }) }));
    await app.handle(new Request("http://b.test/track", { method: "POST", headers: { "user-agent": "curl/8.7.1" }, body: JSON.stringify({ kind: "visit", host: "koola.madcactus.org" }) }));
    const a = tracker.snapshot();
    expect(a.visits).toBe(1);
    expect(BOT_UA.test("curl/8.7.1")).toBe(true);
    expect(BOT_UA.test(chrome)).toBe(false);
  });
});

describe("gates", () => {
  test("keyOk accepts query param and x-activity-key header only with a key set", () => {
    process.env.ACTIVITY_KEY = "k123";
    expect(keyOk(req("/activity?key=k123"))).toBe(true);
    expect(keyOk(req("/activity", { "x-activity-key": "k123" }))).toBe(true);
    expect(keyOk(req("/activity?key=wrong"))).toBe(false);
    delete process.env.ACTIVITY_KEY;
    expect(keyOk(req("/activity?key=k123"))).toBe(false);
  });

  test("ownerCookieOk verifies HMAC + expiry; isMe accepts legacy me=1", () => {
    process.env.OWNER_SECRET = "s3cret";
    expect(ownerCookieOk(req("/", { cookie: mintOwner("s3cret") }))).toBe(true);
    expect(ownerCookieOk(req("/", { cookie: mintOwner("other") }))).toBe(false);
    expect(ownerCookieOk(req("/", { cookie: mintOwner("s3cret", Date.now() - 1) }))).toBe(false);
    delete process.env.OWNER_SECRET;
    expect(ownerCookieOk(req("/", { cookie: mintOwner("s3cret") }))).toBe(false);
    expect(isMe(req("/", { cookie: "me=1" }))).toBe(true);
  });

  test("tokenOk exempts /healthz, honours ?token= and the stamped cookie", () => {
    delete process.env.ACCESS_TOKEN;
    expect(tokenOk(req("/anything"))).toBe(true);
    process.env.ACCESS_TOKEN = "t9";
    expect(tokenOk(req("/healthz"))).toBe(true);
    expect(tokenOk(req("/?token=t9"))).toBe(true);
    expect(tokenOk(req("/", { cookie: "demo_token=t9" }))).toBe(true);
    expect(tokenOk(req("/"))).toBe(false);
    expect(tokenCookie(req("/?token=t9"))).toContain("demo_token=t9");
    expect(tokenCookie(req("/"))).toBe("");
  });
});

describe("handleVisit + mounted routes", () => {
  test("handleVisit stamps me-cookie on ?key=, demo suppresses it, tracks nothing server-side", () => {
    process.env.ACTIVITY_KEY = "k123";
    let v = handleVisit(req("/"));
    expect(v.meCookie).toBe("");
    v = handleVisit(req("/?key=k123"));
    expect(v.meCookie).toContain("me=1");
    v = handleVisit(req("/?demo=1"));
    expect(v.demo).toBe(true);
    expect(v.meCookie).toBe("");
    expect(tracker.snapshot().visits).toBe(0); // server-side GETs never count
  });

  test("full app: /activity gated, reset clears, ACCESS_TOKEN gates everything but /healthz", async () => {
    process.env.ACTIVITY_KEY = "k123";
    const app = new Elysia().use(brainRoutes(tracker));
    expect((await app.handle(req("/activity"))).status).toBe(401);
    expect((await app.handle(req("/activity", { "x-activity-key": "k123" }))).status).toBe(200);
    await app.handle(req("/activity/reset?key=k123", { method: "POST" }));
    expect(tracker.snapshot().visits).toBe(0);

    process.env.ACCESS_TOKEN = "t9";
    expect((await app.handle(req("/activity?key=k123"))).status).toBe(401);
    expect((await app.handle(req("/activity?key=k123&token=t9"))).status).toBe(200);
    expect((await app.handle(req("/healthz"))).status).toBe(200);
  });
});
