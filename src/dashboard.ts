import { loadConfig } from "./config.ts";
import { onStatus, onTx, type Status, type TxEvent } from "./events.ts";
import { getBalance, openDb } from "./ledger.ts";
import { logInfo } from "./log.ts";
import { startWatcher } from "./watcher.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DASHBOARD_PORT ?? 3000);
const DROP_HOLD_MS = Number(process.env.DROP_HOLD_SECONDS ?? 30) * 1000;

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const usdc = (raw: bigint) => (Number(raw) / 1e6).toFixed(6);

let status: Status = { state: "replaying", fromSlot: 0 };
const recent: TxEvent[] = [];
const clients = new Set<ReadableStreamDefaultController<string>>();

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
  recent.unshift(e);
  recent.length = Math.min(recent.length, 10);
  send("tx", e);
  if (e.action === "credited") send("balance", { usdc: usdc(getBalance(db, cfg.ata)) });
});
onStatus((s) => {
  status = s;
  send("status", s);
});

const watcher = startWatcher(cfg, db);

const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}${cfg.network === "devnet" ? "?cluster=devnet" : ""}`;

// The page is only ever served to this machine. These checks stop another website open in
// your browser from calling the local API (DNS rebinding and cross-site POSTs).
const hostOk = (req: Request) => [`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.get("host") ?? "");
const originOk = (req: Request) => {
  const o = req.headers.get("origin");
  return o === null || o === `http://${HOST}:${PORT}` || o === `http://localhost:${PORT}`;
};

Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (!hostOk(req)) return new Response("bad host", { status: 403 });

    if (req.method === "GET" && url.pathname === "/") return new Response(Bun.file("public/index.html"));

    if (req.method === "GET" && url.pathname === "/events") {
      let ctl!: ReadableStreamDefaultController<string>;
      let ping: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<string>({
        start(c) {
          ctl = c;
          clients.add(c);
          c.enqueue(
            `event: snapshot\ndata: ${JSON.stringify({
              network: cfg.network,
              wallet: cfg.wallet,
              account: cfg.ata,
              balance: usdc(getBalance(db, cfg.ata)),
              status,
              recent: [...recent].reverse(),
              explorerBase: explorer("").replace(/\?.*$/, ""),
              explorerSuffix: cfg.network === "devnet" ? "?cluster=devnet" : "",
              dropHoldSeconds: DROP_HOLD_MS / 1000,
            })}\n\n`,
          );
          ping = setInterval(() => c.enqueue(": ping\n\n"), 15_000);
        },
        cancel() {
          clearInterval(ping);
          clients.delete(ctl);
        },
      });
      return new Response(stream.pipeThrough(new TextEncoderStream()), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      });
    }

    if (req.method === "POST" && (url.pathname === "/drop" || url.pathname === "/reconnect")) {
      if (!originOk(req)) return new Response("bad origin", { status: 403 });
      if (url.pathname === "/drop") watcher.dropConnection(DROP_HOLD_MS);
      else watcher.reconnectNow();
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  },
});

logInfo("dashboard", { url: `http://${HOST}:${PORT}`, network: cfg.network, wallet: cfg.wallet });
process.on("SIGINT", () => {
  watcher.stop();
  process.exit(0);
});
