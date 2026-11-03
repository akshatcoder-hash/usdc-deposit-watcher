import { loadConfig } from "./config.ts";
import { getBalance, openDb } from "./ledger.ts";
import { logInfo } from "./log.ts";
import { startWatcher } from "./watcher.ts";

const killArg = process.argv.find((a) => a.startsWith("--kill-after="));
const killAfterSec = killArg ? Number(killArg.split("=")[1]) : null;

const DROP_HOLD_MS = Number(process.env.DROP_HOLD_SECONDS ?? 20) * 1000;
const cfg = loadConfig();
const db = openDb(cfg.dbPath);

logInfo("watching", { network: cfg.network, wallet: cfg.wallet, usdcAccount: cfg.ata, mint: cfg.usdcMint });
logInfo(`send USDC to ${cfg.wallet} from another wallet to see a deposit`);

const watcher = startWatcher(cfg, db);

if (killAfterSec !== null) {
  setTimeout(() => {
    watcher.dropConnection(DROP_HOLD_MS);
    logInfo(`stream is down for ${DROP_HOLD_MS / 1000}s. send a deposit now; it will be credited on reconnect`);
  }, killAfterSec * 1000);
}

setInterval(() => {
  logInfo("balance", { usdc: (Number(getBalance(db, cfg.ata)) / 1e6).toFixed(6) });
}, 30_000);

process.on("SIGINT", () => {
  watcher.stop();
  process.exit(0);
});
