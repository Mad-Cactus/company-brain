/**
 * Outreach tracking — one events table, no vendor.
 * visit/scroll/click/dwell = the human; mcp_connect/mcp_tool = their agent.
 */

import type { Database } from "bun:sqlite";
import { log } from "./log";

export type TrackKind = "visit" | "scroll" | "click" | "dwell" | "mcp_connect" | "mcp_tool";

export type Tracker = ReturnType<typeof createTracker>;

/** created_at is naive UTC ("YYYY-MM-DD HH:MM:SS" from datetime('now')). The
 * CRM parses these with new Date(), which reads a missing tz as browser-local
 * wall clock (visits showed hours in the future) — tag Z so the instant
 * survives the trip. */
const toIso = (s?: string) => (s && !s.endsWith("Z") ? `${s.replace(" ", "T")}Z` : s);

export function createTracker(sqlite: Database) {
  /** Fire-and-forget insert. Never throws: analytics must never break the gift. */
  function track(kind: TrackKind, detail: Record<string, unknown> = {}) {
    try {
      sqlite.prepare("insert into events (kind, detail) values (?, ?)").run(kind, JSON.stringify(detail));
    } catch (e) {
      log.warn("[track]", e instanceof Error ? e.message : e);
    }
  }

  /** MCP hook: call with the parsed JSON-RPC body of any incoming request. */
  function trackMcp(rpc: { method?: string; params?: { clientInfo?: { name?: string }; name?: string } } | null | undefined) {
    if (rpc?.method === "initialize") track("mcp_connect", { client: rpc.params?.clientInfo?.name ?? "?" });
    else if (rpc?.method === "tools/call") track("mcp_tool", { tool: rpc.params?.name ?? "?" });
  }

  /** Wipe all events — demo/demo-call pollution reset, wired to POST /activity/reset. */
  function clear() {
    sqlite.prepare("delete from events").run();
  }

  /** Rollup for the private dashboard section and GET /activity. Cheap: events table stays tiny. */
  function snapshot() {
    const one = <T>(sql: string): T | undefined => sqlite.prepare(sql).get() as T | undefined;
    const visits = one<{ v: number; d: number; l: string }>(
      `select count(*) v, count(distinct substr(created_at,1,10)) d, max(created_at) l from events where kind='visit'`);
    const connect = one<{ detail: string }>(`select detail from events where kind='mcp_connect' order by id desc limit 1`);
    const tools = one<{ c: number; l: string }>(`select count(*) c, max(created_at) l from events where kind='mcp_tool'`);
    const depth = one<{ m: number | null }>(`select max(cast(json_extract(detail,'$.depth') as int)) m from events where kind='scroll'`);
    const clicks = one<{ c: number }>(`select count(*) c from events where kind='click'`);
    const dwell = one<{ m: number | null }>(`select max(cast(json_extract(detail,'$.secs') as int)) m from events where kind='dwell'`);
    const days = sqlite.prepare(
      `select substr(created_at,1,10) dd, sum(kind='visit') v, sum(kind='mcp_tool') t
       from events where created_at >= datetime('now','-13 days') group by dd order by dd`
    ).all() as { dd: string; v: number; t: number }[];
    const byTool = sqlite.prepare(
      `select json_extract(detail,'$.tool') tool, count(*) c from events where kind='mcp_tool' group by tool order by c desc`
    ).all() as { tool: string; c: number }[];

    let agent: string | undefined;
    try { agent = connect?.detail ? (JSON.parse(connect.detail).client as string | undefined) : undefined; } catch {}

    return {
      visits: visits?.v ?? 0,
      visitDays: visits?.d ?? 0,
      lastVisit: toIso(visits?.l),
      agent,
      toolCalls: tools?.c ?? 0,
      lastToolAt: toIso(tools?.l),
      maxDepth: depth?.m ?? 0,
      clicks: clicks?.c ?? 0,
      maxDwell: dwell?.m ?? 0,
      tools: byTool.map((t) => (t.c > 1 ? `${t.tool}×${t.c}` : t.tool)),
      days,
    };
  }

  return { track, trackMcp, clear, snapshot };
}
