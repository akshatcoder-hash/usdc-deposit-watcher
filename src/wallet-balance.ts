import type { Config } from "./config.ts";

export async function fetchWalletBalance(
  cfg: Config,
  minContextSlot = 0,
  request: (url: string, options: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const response = await request(`${cfg.rpcUrl}/?api-key=${cfg.apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        cfg.wallet,
        { mint: cfg.usdcMint },
        {
          encoding: "jsonParsed",
          commitment: cfg.commitment,
          minContextSlot,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error("Balance RPC unavailable");
  const data = (await response.json()) as {
    error?: unknown;
    result?: {
      value: {
        account: {
          data: {
            parsed: {
              info: {
                tokenAmount: { amount: string; decimals: number };
              };
            };
          };
        };
      }[];
    };
  };
  if (data.error || !Array.isArray(data.result?.value))
    throw new Error("Balance RPC returned no result");
  const amount = data.result.value.reduce((total, entry) => {
    const token = entry.account.data.parsed.info.tokenAmount;
    if (token.decimals !== 6 || !/^\d+$/.test(token.amount))
      throw new Error("Invalid USDC balance");
    return total + BigInt(token.amount);
  }, 0n);
  return `${amount / 1_000_000n}.${String(amount % 1_000_000n).padStart(6, "0")}`;
}
