import { Database } from "bun:sqlite";
import type { CreditResult, Deposit, Source } from "./types.ts";

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, safeIntegers: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS deposits (
      signature  TEXT    NOT NULL,
      account    TEXT    NOT NULL,
      amount     INTEGER NOT NULL,
      sender     TEXT,
      slot       INTEGER NOT NULL,
      block_time INTEGER,
      source     TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (signature, account)
    );
    CREATE TABLE IF NOT EXISTS balances (
      account TEXT PRIMARY KEY,
      amount  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cursor (
      id        INTEGER PRIMARY KEY CHECK (id = 1),
      last_slot INTEGER NOT NULL
    );
  `);
  return db;
}

// Every source calls this and nothing else writes to balances. The UNIQUE key
// makes the insert the idempotency check, and the insert, the balance update
// and the cursor move share one transaction: all three happen or none do.
export function creditDeposit(db: Database, d: Deposit, source: Source): CreditResult {
  const run = db.transaction((): CreditResult => {
    const inserted = db
      .query(
        `INSERT OR IGNORE INTO deposits (signature, account, amount, sender, slot, block_time, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.signature, d.account, d.amount, d.sender, d.slot, d.blockTime, source);
    if (inserted.changes === 0) return "duplicate";

    db.query(
      `INSERT INTO balances (account, amount) VALUES (?, ?)
       ON CONFLICT (account) DO UPDATE SET amount = amount + excluded.amount`,
    ).run(d.account, d.amount);
    advanceCursor(db, d.slot);
    return "credited";
  });
  return run();
}

// Moves forward only, so a replayed older slot never rewinds it.
export function advanceCursor(db: Database, slot: number): void {
  db.query(
    `INSERT INTO cursor (id, last_slot) VALUES (1, ?)
     ON CONFLICT (id) DO UPDATE SET last_slot = max(last_slot, excluded.last_slot)`,
  ).run(slot);
}

export function getCursor(db: Database): number | null {
  const row = db.query("SELECT last_slot FROM cursor WHERE id = 1").get() as { last_slot: bigint } | null;
  return row ? Number(row.last_slot) : null;
}

export function getBalance(db: Database, account: string): bigint {
  const row = db.query("SELECT amount FROM balances WHERE account = ?").get(account) as { amount: bigint } | null;
  return row?.amount ?? 0n;
}

export function countDeposits(db: Database): number {
  return Number((db.query("SELECT count(*) AS n FROM deposits").get() as { n: bigint }).n);
}
