import { loadConfig } from "./config.ts";
import { onStatus, onTx, type Status, type TxEvent } from "./events.ts";
import { countDeposits, openDb } from "./ledger.ts";
import { fetchWalletBalance } from "./wallet-balance.ts";
import { logInfo } from "./log.ts";
import { startWatcher } from "./watcher.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DASHBOARD_PORT ?? 3000);
const DROP_HOLD_MS = Number(process.env.DROP_HOLD_SECONDS ?? 30) * 1000;

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const usdc = (raw: bigint) => (Number(raw) / 1e6).toFixed(6);

const stats = { duplicate: 0, ignored: 0 };
const recentSignatures = (): string[] =>
  (
    db
      .query("SELECT signature FROM deposits ORDER BY rowid DESC LIMIT 12")
      .all() as { signature: string }[]
  )
    .map((r) => r.signature)
    .reverse();
const statsNow = () => ({
  credited: countDeposits(db),
  duplicate: stats.duplicate,
  ignored: stats.ignored,
});

let status: Status = { state: "replaying", fromSlot: 0 };
const recent: TxEvent[] = (
  db
    .query(
      "SELECT signature, amount, slot, source, created_at FROM deposits WHERE account = ? ORDER BY rowid DESC LIMIT 10",
    )
    .all(cfg.ata) as {
    signature: string;
    amount: bigint;
    slot: bigint;
    source: string;
    created_at: string;
  }[]
).map((r) => ({
  t: Date.parse(r.created_at.replace(" ", "T") + "Z"),
  signature: r.signature,
  amount: usdc(r.amount),
  slot: Number(r.slot),
  source: r.source,
  action: "credited",
}));
const clients = new Set<ReadableStreamDefaultController<string>>();
let walletBalance: string | null = null;
let balanceRefresh: Promise<void> | null = null;
let balanceSlot = 0;

function refreshBalance(slot = 0): Promise<void> {
  balanceSlot = Math.max(balanceSlot, slot);
  if (balanceRefresh) return balanceRefresh;
  const requestedSlot = balanceSlot;
  balanceRefresh = (async () => {
    try {
      walletBalance = await fetchWalletBalance(cfg, requestedSlot);
    } catch {
      walletBalance = null;
    }
    send("balance", { usdc: walletBalance });
  })().finally(() => {
    balanceRefresh = null;
    if (balanceSlot > requestedSlot) void refreshBalance();
  });
  return balanceRefresh;
}

function send(event: string, data: unknown): void {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    try {
      c.enqueue(frame);
    } catch {
      clients.delete(c);
    }
  }
}

onTx((e) => {
  if (e.action === "duplicate") stats.duplicate++;
  if (e.action === "ignored") stats.ignored++;
  recent.unshift(e);
  recent.length = Math.min(recent.length, 10);
  send("tx", e);
  void refreshBalance(e.slot);
  send("stats", statsNow());
});
onStatus((s) => {
  status = s;
  send("status", s);
});

const watcher = startWatcher(cfg, db);
void refreshBalance();
setInterval(() => void refreshBalance(), 10_000);

const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}${cfg.network === "devnet" ? "?cluster=devnet" : ""}`;

// The page is only ever served to this machine. These checks stop another website open in
// your browser from calling the local API (DNS rebinding and cross-site POSTs).
const hostOk = (req: Request) =>
  [`${HOST}:${PORT}`, `localhost:${PORT}`].includes(
    req.headers.get("host") ?? "",
  );
const originOk = (req: Request) => {
  const o = req.headers.get("origin");
  return (
    o === null ||
    o === `http://${HOST}:${PORT}` ||
    o === `http://localhost:${PORT}`
  );
};

const snapshot = () => ({
  network: cfg.network,
  wallet: cfg.wallet,
  account: cfg.ata,
  balance: walletBalance,
  commitment: cfg.commitment,
  status,
  recent: [...recent].reverse(),
  stats: statsNow(),
  signatures: recentSignatures(),
  explorerBase: explorer("").replace(/\?.*$/, ""),
  explorerSuffix: cfg.network === "devnet" ? "?cluster=devnet" : "",
  dropHoldSeconds: DROP_HOLD_MS / 1000,
});

Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (!hostOk(req)) return new Response("bad host", { status: 403 });

    if (req.method === "GET" && url.pathname === "/")
      return new Response(Bun.file("public/index.html"), {
        headers: { "cache-control": "no-store" },
      });
    if (req.method === "GET" && url.pathname === "/api/state")
      return Response.json(snapshot(), {
        headers: { "cache-control": "no-store" },
      });
    if (
      req.method === "GET" &&
      [
        "/dashboard.css",
        "/dashboard.js",
        "/machine.css",
        "/machine.js",
      ].includes(url.pathname)
    ) {
      return new Response(Bun.file(`public${url.pathname}`), {
        headers: { "cache-control": "no-store" },
      });
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/machine.svg" ||
        url.pathname === "/machine.json" ||
        url.pathname === "/tokens.css")
    ) {
      return new Response(Bun.file(`public${url.pathname}`));
    }

    if (req.method === "GET" && url.pathname === "/events") {
      let ctl!: ReadableStreamDefaultController<string>;
      let ping: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<string>({
        start(c) {
          ctl = c;
          clients.add(c);
          c.enqueue(
            `retry: 1000\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`,
          );
          ping = setInterval(() => c.enqueue(": ping\n\n"), 15_000);
        },
        cancel() {
          clearInterval(ping);
          clients.delete(ctl);
        },
      });
      return new Response(stream.pipeThrough(new TextEncoderStream()), {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    if (
      req.method === "POST" &&
      (url.pathname === "/drop" || url.pathname === "/reconnect")
    ) {
      if (!originOk(req)) return new Response("bad origin", { status: 403 });
      if (url.pathname === "/drop") watcher.dropConnection(DROP_HOLD_MS);
      else watcher.reconnectNow();
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  },
});

logInfo("dashboard", {
  url: `http://${HOST}:${PORT}`,
  network: cfg.network,
  wallet: cfg.wallet,
});
process.on("SIGINT", () => {
  watcher.stop();
  process.exit(0);
});
