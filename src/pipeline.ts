import type { Database } from "bun:sqlite";
import { advanceCursor, creditDeposit } from "./ledger.ts";
import { logEvent } from "./log.ts";
import { parseDeposit } from "./parse.ts";
import type { CreditResult, NormalizedTx, Source } from "./types.ts";

export interface PipelineDeps {
  db: Database;
  account: string;
  mint: string;
  fetchBlockTime?: (slot: number) => Promise<number | null>;
}

// parse -> credit -> log. Used by the stream today; a webhook handler or a
// backfill loop would call the same function with a different source label.
export async function handleTx(deps: PipelineDeps, tx: NormalizedTx, source: Source): Promise<CreditResult | "ignored"> {
  const deposit = parseDeposit(tx, deps.account, deps.mint);
  if (!deposit) {
    advanceCursor(deps.db, tx.slot);
    logEvent({ source, signature: tx.signature, slot: tx.slot, action: "ignored" });
    return "ignored";
  }
  deposit.blockTime = (await deps.fetchBlockTime?.(tx.slot).catch(() => null)) ?? null;
  const result = creditDeposit(deps.db, deposit, source);
  logEvent({ source, signature: tx.signature, slot: tx.slot, action: result, amount: (Number(deposit.amount) / 1e6).toFixed(6) });
  return result;
}
