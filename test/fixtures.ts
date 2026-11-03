import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { deriveAta } from "../src/config.ts";
import type { StreamUpdate } from "../src/parse.ts";

export const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const WALLET = Keypair.generate().publicKey.toBase58();
export const ATA = deriveAta(WALLET, MINT);
export const SENDER = Keypair.generate().publicKey.toBase58();
const SENDER_ATA = Keypair.generate().publicKey.toBase58();

const bytes = (s: string) => bs58.decode(s);
let counter = 0;

// A stream update shaped like what LaserStream delivers: bytes for keys and
// signatures, decimal strings for u64 values.
export function depositUpdate(opts: { slot: number; amount?: bigint; signature?: string; failed?: boolean }): StreamUpdate {
  const amount = opts.amount ?? 10_000n;
  const n = ++counter;
  const signature = opts.signature ?? bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + n) % 256));
  return {
    transaction: {
      slot: String(opts.slot),
      transaction: {
        signature: bytes(signature),
        isVote: false,
        transaction: { message: { accountKeys: [SENDER, SENDER_ATA, ATA].map(bytes) } },
        meta: {
          err: opts.failed ? { err: "InstructionError" } : null,
          preTokenBalances: [
            { accountIndex: 1, mint: MINT, owner: SENDER, uiTokenAmount: { amount: "5000000" } },
            { accountIndex: 2, mint: MINT, owner: WALLET, uiTokenAmount: { amount: "0" } },
          ],
          postTokenBalances: [
            { accountIndex: 1, mint: MINT, owner: SENDER, uiTokenAmount: { amount: String(5_000_000n - amount) } },
            { accountIndex: 2, mint: MINT, owner: WALLET, uiTokenAmount: { amount: String(amount) } },
          ],
          loadedWritableAddresses: [],
          loadedReadonlyAddresses: [],
        },
      },
    },
  };
}
