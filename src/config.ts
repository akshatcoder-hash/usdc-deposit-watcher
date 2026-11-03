import { PublicKey } from "@solana/web3.js";

export type Network = "devnet" | "mainnet";

// The single switch. Changing NETWORK changes the stream endpoint, the RPC
// endpoint and the USDC mint together. Nothing else in the repo reads a network name.
export const NETWORKS = {
  devnet: {
    laserstream: "https://laserstream-devnet-ewr.helius-rpc.com",
    rpc: "https://devnet.helius-rpc.com",
    usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  mainnet: {
    laserstream: "https://laserstream-mainnet-ewr.helius-rpc.com",
    rpc: "https://mainnet.helius-rpc.com",
    usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
} as const;

export type CommitmentName = "confirmed" | "finalized";

export interface Config {
  network: Network;
  laserstreamEndpoint: string;
  rpcUrl: string;
  usdcMint: string;
  apiKey: string;
  wallet: string;
  ata: string;
  commitment: CommitmentName;
  dbPath: string;
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function deriveAta(wallet: string, mint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(wallet).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM,
  );
  return ata.toBase58();
}

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing ${key}. Copy .env.example to .env and fill it in.`);
  return v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const network = (env.NETWORK ?? "devnet") as Network;
  if (!(network in NETWORKS)) throw new Error(`NETWORK must be devnet or mainnet, got "${network}"`);
  const commitment = (env.COMMITMENT ?? "finalized") as CommitmentName;
  if (commitment !== "confirmed" && commitment !== "finalized") {
    throw new Error(`COMMITMENT must be confirmed or finalized, got "${commitment}"`);
  }
  const n = NETWORKS[network];
  const wallet = required(env, "WATCH_WALLET");
  return {
    network,
    laserstreamEndpoint: n.laserstream,
    rpcUrl: n.rpc,
    usdcMint: n.usdcMint,
    apiKey: required(env, "HELIUS_API_KEY"),
    wallet,
    ata: deriveAta(wallet, n.usdcMint),
    commitment,
    dbPath: env.DB_PATH ?? "./deposits.db",
  };
}
