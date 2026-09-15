# company-brain

The underlay every Mad Cactus company brain shares: outreach activity tracking, self-exclusion gates, and the `/activity` API the [Mad Cactus](https://madcactus.org) CRM pulls.

A company brain is a client's industry live data, organized so any AI can use it. Each brain (koola-brain, mo-strategies-brain, …) is one Bun process: HTTP + MCP + SQLite. The domain data differs per client; this package is everything that used to get copy-pasted between them.

## What's in it

- **Tracker** — one `events` table, no analytics vendor. Visits, scroll depth, clicks, dwell, and — the part that matters — every MCP connect and tool call the prospect's AI makes. Rollup ships ISO-UTC timestamps (naive strings parsed as browser-local showed visits hours in the future — learned the hard way).
- **Gates** — `ACTIVITY_KEY` (CRM API + self-exclusion in one secret), HMAC owner cookie (the dashboard marks Collin's browser so his own views never count), `?demo=1` screenshare mode, and an optional `ACCESS_TOKEN` lock over every route.
- **Elysia plugin** — `/healthz`, `/track`, `/activity`, `/activity/reset` wired in one `.use()`.

## Use

```ts
import { openSqlite, ensureEventsTable, createTracker, brainRoutes, handleVisit } from "@aspectrr/company-brain";

const sqlite = openSqlite("./data/brain.db");
ensureEventsTable(sqlite);
const activity = createTracker(sqlite);

new Elysia()
  .use(brainRoutes(activity))          // /healthz /track /activity /activity/reset + token gate
  .get("/", ({ request, set }) => {
    const { demo, meCookie } = handleVisit(request, activity);
    if (meCookie) set.headers["set-cookie"] = meCookie;
    return dashboardHtml(demo);
  })
  .all("/mcp", ({ request }) => {
    const rpc = await request.json().catch(() => null);
    activity.trackMcp(rpc);            // mcp_connect / mcp_tool
    // ...domain tools
  });
```

Prod env: `ACTIVITY_KEY`, `OWNER_SECRET`, `ACCESS_TOKEN`, all optional — unset means open (dev-friendly, gate-free).

## Conventions worth stealing

- Tracking never breaks a request. Every insert is fire-and-forget; a full disk loses an event, not the demo.
- One secret does triple duty: `/?key=<ACTIVITY_KEY>` authenticates the CRM pull, marks your own browser, and doubles as your preview link.
- `?demo=1` renders the real page but injects no beacons — screenshares leave zero pollution.

Running in prod inside [koola-brain](https://github.com/Mad-Cactus/koola-brain) and [mo-strategies-brain](https://github.com/Mad-Cactus/mo-strategies-brain) (flora-brain next).

Built by [Mad Cactus](https://madcactus.org). MIT.
