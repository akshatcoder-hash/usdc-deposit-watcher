# usdc-deposit-watcher

Detect incoming USDC deposits to a Solana wallet with Helius LaserStream, and credit each one exactly once, even when the stream drops.

At SurfCash, an offramp turned USDC into local money (PIX in Brazil, VietQR in Vietnam). The app had to notice an incoming USDC transfer right away and credit the user one time. Zero times is a lost deposit, which happens if you miss a transaction while the websocket is down. Two times is money out the door, which happens if the stream and a webhook both deliver the same transaction. This repo is a small starter that gets both cases right. It runs on devnet by default.

## Quickstart

```sh
git clone https://github.com/akshatcoder-hash/usdc-deposit-watcher && cd usdc-deposit-watcher
bun install
cp .env.example .env          # set HELIUS_API_KEY and WATCH_WALLET (a public address)
bun test
bun run demo
```

To see a deposit, get devnet USDC from [faucet.circle.com](https://faucet.circle.com) (choose Solana Devnet) and send 0.01 USDC to `WATCH_WALLET` from a different wallet you control. The watcher prints one JSON line per event:

```json
{"source":"stream","signature":"5mhP...","slot":518304542,"action":"credited","amount":"0.010000"}
```

To watch a disconnect and recovery, run `bun run demo:kill` (same as `bun run src/demo.ts --kill-after=20`). It cancels the stream 20 seconds in. Send a deposit while it is down. On reconnect the watcher resubscribes from the last saved slot and credits it once. This is real output from a devnet run of that flag, with signatures shortened:

```text
{"msg":"subscribing","fromSlot":518304056,"commitment":"confirmed", ...}
{"source":"stream","signature":"b2Cg...","slot":518304703,"action":"ignored"}
{"msg":"kill flag: dropping the stream now"}
{"msg":"stream closed","reason":"dropped"}
{"msg":"reconnecting","inMs":157}
{"msg":"subscribing","fromSlot":518304703,"commitment":"confirmed", ...}
{"source":"stream","signature":"b2Cg...","slot":518304703,"action":"ignored"}
```

The last line is the same transaction as the one before the drop. Resuming from the saved slot replays that slot, and crediting is built to survive that.

## Three ways deposit detection usually goes wrong

### 1. Missing deposits while disconnected

A stream only tells you about what happens while you are connected. This repo saves the last processed slot in SQLite, in the same transaction that credits the deposit ([`src/ledger.ts:48`](src/ledger.ts#L48)). The cursor only moves forward ([`src/ledger.ts:58`](src/ledger.ts#L58)). Every connect reads it and passes it to LaserStream as `fromSlot` ([`src/watcher.ts:45`](src/watcher.ts#L45), [`src/watcher.ts:86`](src/watcher.ts#L86)). LaserStream replays up to about 48 hours, so a restart or a crash resumes where it stopped. If the saved slot is older than that window, the watcher clamps to the oldest replayable slot and logs a warning ([`src/watcher.ts:52`](src/watcher.ts#L52)), because deposits in that gap need a backfill (see Next). Reconnects use exponential backoff with full jitter ([`src/watcher.ts:9`](src/watcher.ts#L9)).

### 2. Double-crediting across sources

The stream replays after every reconnect, and a webhook can deliver the same event more than once. Helius says webhook delivery is not exactly-once. So deduplication cannot live in the sources. It lives in one function, `creditDeposit()` ([`src/ledger.ts:34`](src/ledger.ts#L34)). The `deposits` table has `UNIQUE (signature, account)` ([`src/ledger.ts:17`](src/ledger.ts#L17)). The insert uses `INSERT OR IGNORE` ([`src/ledger.ts:38`](src/ledger.ts#L38)). If it inserted nothing, the function returns `duplicate` and does not touch the balance. The insert, the balance update and the cursor move run inside one `db.transaction` ([`src/ledger.ts:35`](src/ledger.ts#L35)), so there is no state where a deposit is recorded but not counted. Tests 1 and 2 in [`test/deposits.test.ts`](test/deposits.test.ts) cover the stream-twice and stream-plus-webhook cases.

### 3. Trusting `confirmed` without a plan for rollbacks

A `confirmed` transaction can still be dropped if its fork loses. This repo avoids the problem by choosing not to credit early: `COMMITMENT` defaults to `finalized`, so a credit never needs to be reversed. The cost is a delay of roughly 13 seconds or more before the user sees the credit. If you set `COMMITMENT=confirmed` you get faster credits, but this repo has no rollback logic, so you would have to add a "pending" state and a reversal path yourself. The setting is read in [`src/config.ts`](src/config.ts) and passed to the subscription in [`src/watcher.ts`](src/watcher.ts).

## How a deposit is detected

A transaction counts as a deposit only if it succeeded ([`src/parse.ts:8`](src/parse.ts#L8)), it touches the watched token account, and that account's balance for the USDC mint went up between `preTokenBalances` and `postTokenBalances` ([`src/parse.ts:17`](src/parse.ts#L17)). Instructions are never inspected. The sender is the owner of the USDC account whose balance dropped the most. Failed transactions, other mints and outgoing transfers are logged as `ignored`. The amount is stored as an integer in base units (USDC has 6 decimals) to avoid float errors.

The watcher subscribes to the wallet's USDC associated token account (ATA), derived from `WATCH_WALLET` and the mint.

**Edge case: USDC in a non-ATA account.** A wallet can own more than one USDC token account, and someone can send to any of them. This repo watches one account. To watch a specific other account, set `WATCH_TOKEN_ACCOUNT`. To cover every token account a wallet owns, the LaserStream SDK has a transaction filter, `tokenAccounts: "balanceChanged"`, which also matches transactions that change the balance of any token account owned by an `accountInclude` wallet. You would put the wallet in `accountInclude`, set that flag, and make `parseDeposit` check the owner of each balance entry instead of one account. That is not built here.

## Diagram

```text
 LaserStream (gRPC) ----+
   resume from          |
   saved slot           |
                        v
 Webhook (Next) -----> handleTx() --> parseDeposit() --> creditDeposit() --> SQLite
                        ^   (src/pipeline.ts)          (one transaction)     deposits  UNIQUE(signature, account)
 Backfill (Next) -------+                                                    balances
                                                                             cursor    last_slot
```

All sources feed the same function, and `creditDeposit()` is the only code that writes balances.

## Config

One switch, `NETWORK`, in `.env`. It selects the stream endpoint, the RPC endpoint and the USDC mint together ([`src/config.ts:6`](src/config.ts#L6)).

| Variable | Meaning |
| --- | --- |
| `NETWORK` | `devnet` (default) or `mainnet` |
| `HELIUS_API_KEY` | Helius API key |
| `WATCH_WALLET` | Public address of the wallet to watch |
| `WATCH_TOKEN_ACCOUNT` | Optional. Watch this token account instead of the wallet's ATA |
| `COMMITMENT` | `finalized` (default) or `confirmed` |
| `DB_PATH` | SQLite file, default `./deposits.db` |

Never put a private key in this project. The watcher only needs a public address.

## Running on mainnet

Three things change.

1. **Endpoint.** Set `NETWORK=mainnet`. That switches the stream to `https://laserstream-mainnet-ewr.helius-rpc.com` (other regions are listed in the LaserStream docs; edit the `mainnet.laserstream` value in `src/config.ts` to use another).
2. **Mint.** The same switch changes the USDC mint from the Circle devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` to mainnet USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
3. **Plan.** LaserStream on mainnet requires a Helius Business or Professional plan. Devnet LaserStream is available on lower plans. The docs disagree on how low: one page says every plan, another says Developer and above. Check the plan page for yours.

Use a mainnet API key from your dashboard. Use a new `DB_PATH` so devnet and mainnet records do not mix.

## What was tested

- `bun test` runs tests 1 to 3 from fixtures shaped like LaserStream updates (byte signatures and keys, decimal-string slots). No network calls. They cover a duplicate from the stream, the same signature from the stream and a webhook source, and a drop followed by five deposits and a replay that credits all five once.
- The live path (devnet LaserStream connection, `fromSlot` replay, the kill flag, reconnect from the saved slot) was run against Helius devnet using a busy devnet USDC account. In that run every transaction was an outgoing transfer, so every event was correctly `ignored`.
- A real incoming USDC deposit through the live stream is not covered by any automated test. Do the quickstart send to check it on your own wallet.

## Next

Not built, in rough priority order:

- Tests 4 to 6: a gap longer than the replay window, failed/non-USDC/outgoing transactions ignored, and a crash between insert and balance update leaving no half state. The last one should hold because both writes share one SQLite transaction, but there is no test for it yet.
- Backfill with `getSignaturesForAddress` (paginated, `until` the last seen signature), for gaps beyond the replay window.
- Webhook endpoint: an HTTP server that checks the `Authorization` header Helius echoes back and calls the same `handleTx()` with `source: "webhook"`. Raw webhooks include failed transactions, which `parseDeposit` already rejects.
- A pending then final flow: credit at `confirmed`, mark final at `finalized`, reverse if dropped.
- Advance the cursor when idle (for example from slot updates), so a long quiet period does not leave the saved slot beyond the replay window.
- Cover all token accounts owned by a wallet with the `tokenAccounts` filter.

## Docs used

- LaserStream overview: https://www.helius.dev/docs/laserstream
- LaserStream gRPC quickstart (subscribe, `fromSlot`, endpoints): https://www.helius.dev/docs/laserstream/grpc
- Historical replay (48 hours, finalized-only beyond about 20 minutes): https://www.helius.dev/docs/laserstream/historical-replay.md
- LaserStream SDK on npm: https://www.npmjs.com/package/helius-laserstream
- Webhooks overview: https://www.helius.dev/docs/webhooks
- Webhooks FAQ (auth header, devnet types, retries and duplicates): https://www.helius.dev/docs/faqs/webhooks.md
- Circle USDC addresses: https://developers.circle.com/stablecoins/usdc-contract-addresses

## License

MIT
