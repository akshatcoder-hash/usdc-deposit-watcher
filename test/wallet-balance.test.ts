import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { fetchWalletBalance } from "../src/wallet-balance.ts";

const cfg = loadConfig({
  NETWORK: "devnet",
  HELIUS_API_KEY: "fixture",
  WATCH_WALLET: "3vTKRP9uzHvyg4bGXNztHqg5zvSxt78ogQkRiHGaS4tF",
});
const response = (...amounts: string[]) =>
  Response.json({
    result: {
      value: amounts.map((amount) => ({
        account: {
          data: { parsed: { info: { tokenAmount: { amount, decimals: 6 } } } },
        },
      })),
    },
  });

test("wallet balance falls after an outgoing transfer and reaches zero", async () => {
  const states = ["20000000", "10000000", "0"];
  const request = async () => response(states.shift()!);
  expect(await fetchWalletBalance(cfg, 0, request)).toBe("20.000000");
  expect(await fetchWalletBalance(cfg, 0, request)).toBe("10.000000");
  expect(await fetchWalletBalance(cfg, 0, request)).toBe("0.000000");
});

test("balances include every USDC account owned by the wallet", async () => {
  const request = async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    expect(body.method).toBe("getTokenAccountsByOwner");
    expect(body.params).toEqual([
      cfg.wallet,
      { mint: cfg.usdcMint },
      { encoding: "jsonParsed", commitment: "finalized", minContextSlot: 123 },
    ]);
    return response("4000000", "6000001");
  };
  expect(await fetchWalletBalance(cfg, 123, request)).toBe("10.000001");
});

test("a wallet without USDC accounts has a zero balance", async () => {
  expect(await fetchWalletBalance(cfg, 0, async () => response())).toBe(
    "0.000000",
  );
});

test("RPC failure is unavailable, never an invented zero balance", async () => {
  const request = async () => Response.json({ error: { code: -32016 } });
  expect(fetchWalletBalance(cfg, 0, request)).rejects.toThrow(
    "Balance RPC returned no result",
  );
});
