// A transaction reduced to the fields deposit detection needs. Every source
// (stream, webhook, backfill) is adapted into this shape, so parsing lives in one place.
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner: string;
  amount: bigint; // raw base units (USDC has 6 decimals)
}

export interface NormalizedTx {
  signature: string;
  slot: number;
  failed: boolean;
  accountKeys: string[]; // static keys followed by loaded address-table keys
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
}

export type Source = "stream" | "webhook" | "backfill";

export interface Deposit {
  signature: string;
  account: string; // the watched token account
  amount: bigint;
  sender: string | null;
  slot: number;
  blockTime: number | null;
}

export type CreditResult = "credited" | "duplicate";
