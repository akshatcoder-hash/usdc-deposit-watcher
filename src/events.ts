import { EventEmitter } from "node:events";
import { logEvent, type Action } from "./log.ts";

export interface TxEvent {
  t: number;
  source: string;
  signature: string;
  slot: number;
  action: Action;
  amount?: string;
}

export type Status =
  | { state: "live" }
  | { state: "dropped"; reconnectAt: number }
  | { state: "replaying"; fromSlot: number };

const bus = new EventEmitter();

// Logs the event as one JSON line and lets the dashboard hear about it.
export function publishTx(e: Omit<TxEvent, "t">): void {
  logEvent(e);
  bus.emit("tx", { t: Date.now(), ...e } satisfies TxEvent);
}

export const publishStatus = (s: Status): void => void bus.emit("status", s);
export const onTx = (fn: (e: TxEvent) => void): void => void bus.on("tx", fn);
export const onStatus = (fn: (s: Status) => void): void => void bus.on("status", fn);
