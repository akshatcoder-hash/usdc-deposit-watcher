import { CommitmentLevel, LaserstreamClient, subscribe, type LaserstreamConfig, type StreamHandle } from "helius-laserstream";
import type { Config } from "./config.ts";
import { advanceCursor, getCursor } from "./ledger.ts";
import { logInfo } from "./log.ts";
import { fromStreamUpdate, type StreamUpdate } from "./parse.ts";
import { handleTx, type PipelineDeps } from "./pipeline.ts";
import type { Database } from "bun:sqlite";

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(30_000, 500 * 2 ** attempt);
  return Math.floor(random() * ceiling); // full jitter
}

async function fetchBlockTime(rpcUrl: string, apiKey: string, slot: number): Promise<number | null> {
  const res = await fetch(`${rpcUrl}/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBlockTime", params: [slot] }),
  });
  const json = (await res.json()) as { result?: number | null };
  return json.result ?? null;
}

export interface Watcher {
  stop(): void;
  dropConnection(): void;
}

// Keeps one subscription alive. Each (re)connect resumes from the last slot
// stored in SQLite, so a disconnect cannot skip a deposit. The SDK also
// reconnects on its own; both paths are safe because crediting is idempotent.
export function startWatcher(cfg: Config, db: Database): Watcher {
  const lsConfig: LaserstreamConfig = { apiKey: cfg.apiKey, endpoint: cfg.laserstreamEndpoint };
  const deps: PipelineDeps = {
    db,
    account: cfg.ata,
    mint: cfg.usdcMint,
    fetchBlockTime: (slot) => fetchBlockTime(cfg.rpcUrl, cfg.apiKey, slot),
  };
  let stopped = false;
  let handle: StreamHandle | null = null;
  let closeCurrent: (() => void) | null = null;

  async function resumeSlot(client: LaserstreamClient): Promise<number> {
    const saved = getCursor(db);
    if (saved === null) {
      const { slot } = await client.getSlot();
      advanceCursor(db, Number(slot));
      logInfo("first run, starting at current slot", { slot });
      return Number(slot);
    }
    const { firstAvailable } = await client.subscribeReplayInfo();
    if (firstAvailable !== undefined && saved < Number(firstAvailable)) {
      logInfo("saved slot is older than the replay window, deposits in the gap need a backfill", {
        saved,
        firstAvailable,
      });
      return Number(firstAvailable);
    }
    return saved;
  }

  async function loop(): Promise<void> {
    const client = new LaserstreamClient({ apiKey: cfg.apiKey, endpoint: cfg.laserstreamEndpoint });
    let attempt = 0;
    while (!stopped) {
      try {
        const fromSlot = await resumeSlot(client);
        logInfo("subscribing", { fromSlot, commitment: cfg.commitment, account: cfg.ata });
        const closed = new Promise<string>((resolve) => {
          closeCurrent = () => resolve("dropped");
          subscribe(
            lsConfig,
            {
              transactions: {
                deposits: { accountInclude: [cfg.ata], accountExclude: [], accountRequired: [], vote: false, failed: false },
              },
              commitment: cfg.commitment === "finalized" ? CommitmentLevel.FINALIZED : CommitmentLevel.CONFIRMED,
              accounts: {},
              slots: {},
              transactionsStatus: {},
              blocks: {},
              blocksMeta: {},
              entry: {},
              accountsDataSlice: [],
              fromSlot,
            },
            async (update) => {
              const tx = fromStreamUpdate(update as StreamUpdate);
              if (tx) {
                attempt = 0;
                await handleTx(deps, tx, "stream");
              }
            },
            async (err) => resolve(`error: ${err.message}`),
          ).then((h) => {
            handle = h;
          }, (err: Error) => resolve(`error: ${err.message}`));
        });
        const reason = await closed;
        handle?.cancel();
        handle = null;
        if (stopped) return;
        logInfo("stream closed", { reason });
      } catch (err) {
        logInfo("resume failed", { error: (err as Error).message });
      }
      const wait = backoffMs(attempt++);
      logInfo("reconnecting", { inMs: wait });
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  void loop();
  return {
    stop() {
      stopped = true;
      handle?.cancel();
      closeCurrent?.();
    },
    dropConnection() {
      logInfo("kill flag: dropping the stream now");
      handle?.cancel();
      closeCurrent?.();
    },
  };
}
