import { beforeEach, expect, spyOn, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { countDeposits, getBalance, getCursor, openDb } from "../src/ledger.ts";
import { fromStreamUpdate } from "../src/parse.ts";
import { handleTx } from "../src/pipeline.ts";
import type { Source } from "../src/types.ts";
import { ATA, MINT, SENDER, depositUpdate } from "./fixtures.ts";

let db: Database;
const deps = () => ({ db, account: ATA, mint: MINT });

async function deliver(update: ReturnType<typeof depositUpdate>, source: Source) {
  const tx = fromStreamUpdate(update);
  if (!tx) throw new Error("fixture did not normalize");
  return handleTx(deps(), tx, source);
}

beforeEach(() => {
  db = openDb(":memory:");
  spyOn(console, "log").mockImplementation(() => {});
});

test("1. the same signature delivered twice by the stream is credited once", async () => {
  const update = depositUpdate({ slot: 100, amount: 10_000n });

  expect(await deliver(update, "stream")).toBe("credited");
  expect(await deliver(update, "stream")).toBe("duplicate");

  expect(countDeposits(db)).toBe(1);
  expect(getBalance(db, ATA)).toBe(10_000n);
});

test("2. the same signature from stream and webhook is credited once", async () => {
  const update = depositUpdate({ slot: 100, amount: 10_000n });

  expect(await deliver(update, "stream")).toBe("credited");
  expect(await deliver(update, "webhook")).toBe("duplicate");

  expect(countDeposits(db)).toBe(1);
  expect(getBalance(db, ATA)).toBe(10_000n);
});

test("3. stream drops at slot N, five deposits land after it, reconnect credits all five once", async () => {
  const chain = [
    depositUpdate({ slot: 100 }),
    ...[101, 102, 103, 104, 105].map((slot) => depositUpdate({ slot })),
  ];
  const replayFrom = (slot: number) => chain.filter((u) => Number(u.transaction!.slot) >= slot);

  await deliver(chain[0]!, "stream");
  expect(getCursor(db)).toBe(100);

  // The connection is down while slots 101..105 land. Reconnect resumes from the saved slot.
  for (const update of replayFrom(getCursor(db)!)) await deliver(update, "stream");

  expect(countDeposits(db)).toBe(6);
  expect(getBalance(db, ATA)).toBe(60_000n);
  expect(getCursor(db)).toBe(105);

  // A second reconnect replays everything again and changes nothing.
  for (const update of replayFrom(getCursor(db)!)) await deliver(update, "stream");
  expect(countDeposits(db)).toBe(6);
  expect(getBalance(db, ATA)).toBe(60_000n);
});

test("records amount, sender and slot from pre/post token balances", async () => {
  await deliver(depositUpdate({ slot: 7, amount: 1_234_567n }), "stream");
  const row = db.query("SELECT amount, sender, slot FROM deposits").get() as { amount: bigint; sender: string; slot: bigint };
  expect(row.amount).toBe(1_234_567n);
  expect(row.sender).toBe(SENDER);
  expect(row.slot).toBe(7n);
});
