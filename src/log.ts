export type Action = "credited" | "duplicate" | "ignored";

// One JSON line per event.
export function logEvent(e: { source: string; signature: string; slot: number; action: Action; amount?: string }): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...e }));
}

export function logInfo(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
}
