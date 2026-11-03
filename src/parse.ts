import bs58 from "bs58";
import type { Deposit, NormalizedTx, TokenBalance } from "./types.ts";

// A deposit is a successful transaction in which the watched token account's
// balance for the USDC mint went up. Pre/post token balances are the truth.
// Instructions are never inspected, so CPI transfers and Transfer/TransferChecked all look the same.
export function parseDeposit(tx: NormalizedTx, watchedAccount: string, mint: string): Deposit | null {
  if (tx.failed) return null;

  const index = tx.accountKeys.indexOf(watchedAccount);
  if (index === -1) return null;

  const pre = tx.preTokenBalances.find((b) => b.accountIndex === index && b.mint === mint);
  const post = tx.postTokenBalances.find((b) => b.accountIndex === index && b.mint === mint);
  if (!post) return null;

  const delta = post.amount - (pre?.amount ?? 0n);
  if (delta <= 0n) return null;

  return {
    signature: tx.signature,
    account: watchedAccount,
    amount: delta,
    sender: findSender(tx, mint, index),
    slot: tx.slot,
    blockTime: null,
  };
}

// The sender is the owner of the USDC account whose balance dropped the most.
function findSender(tx: NormalizedTx, mint: string, watchedIndex: number): string | null {
  let best: { owner: string; drop: bigint } | null = null;
  for (const pre of tx.preTokenBalances) {
    if (pre.mint !== mint || pre.accountIndex === watchedIndex) continue;
    const post = tx.postTokenBalances.find((b) => b.accountIndex === pre.accountIndex && b.mint === mint);
    const drop = pre.amount - (post?.amount ?? 0n);
    if (drop > 0n && (!best || drop > best.drop)) best = { owner: pre.owner, drop };
  }
  return best?.owner ?? null;
}

type Bytes = string | Uint8Array | null | undefined;
const b58 = (v: Bytes): string => (typeof v === "string" ? v : bs58.encode(v ?? new Uint8Array()));

interface RawBalance {
  accountIndex?: number | null;
  mint?: string | null;
  owner?: string | null;
  uiTokenAmount?: { amount?: string | null } | null;
}

const toBalances = (list: RawBalance[] | null | undefined): TokenBalance[] =>
  (list ?? []).map((b) => ({
    accountIndex: b.accountIndex ?? -1,
    mint: b.mint ?? "",
    owner: b.owner ?? "",
    amount: BigInt(b.uiTokenAmount?.amount ?? "0"),
  }));

// Shape of a LaserStream transaction update (Yellowstone-compatible), reduced to what we read.
export interface StreamUpdate {
  transaction?: {
    slot?: unknown;
    transaction?: {
      signature?: Bytes;
      isVote?: boolean | null;
      transaction?: { message?: { accountKeys?: Bytes[] | null } | null } | null;
      meta?: {
        err?: unknown;
        preTokenBalances?: RawBalance[] | null;
        postTokenBalances?: RawBalance[] | null;
        loadedWritableAddresses?: Bytes[] | null;
        loadedReadonlyAddresses?: Bytes[] | null;
      } | null;
    } | null;
  } | null;
}

export function fromStreamUpdate(update: StreamUpdate): NormalizedTx | null {
  const outer = update.transaction;
  const info = outer?.transaction;
  if (!outer || !info?.meta) return null;
  const meta = info.meta;
  return {
    signature: b58(info.signature),
    slot: Number(String(outer.slot ?? 0)),
    failed: meta.err != null,
    accountKeys: [
      ...(info.transaction?.message?.accountKeys ?? []),
      ...(meta.loadedWritableAddresses ?? []),
      ...(meta.loadedReadonlyAddresses ?? []),
    ].map(b58),
    preTokenBalances: toBalances(meta.preTokenBalances),
    postTokenBalances: toBalances(meta.postTokenBalances),
  };
}
