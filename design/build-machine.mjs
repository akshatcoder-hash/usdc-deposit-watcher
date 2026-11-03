// Draws the deposit machine: LaserStream hopper -> creditDeposit() gate -> ledger bin.
// Output goes to public/machine.svg and public/machine.json. Run: bun design/build-machine.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./anatomy-kit.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const W = 1000, H = 560;

const PLATE = { x: -235, y: -84, w: 430, d: 172, r: 8 };
const PLATE_H = 12, FOOT_H = 5;
const Z0 = 6; // top of the rail bed, where coins slide
const COIN_R = 7.4, COIN_H = 3.6;

const RAIL = { from: -168, to: 70 };
const GATE_X = -9;
const FLAP_X = 22;
const IGN = { x: -128, y: 26, w: 34, d: 30 };
const DUP = { x: 22, y: 26, w: 36, d: 30 };
const BIN = { x: 66, y: -34, w: 62, d: 68 };
const COUNTER = { x: 134, y: -34, w: 44, d: 36 };
const DIAL = [156, -16], DIAL_R = 14, DIAL_Z = 30, DIAL_TOP = DIAL_Z + 6;
const RACK = { x: -62, y: -66, w: 104, d: 18 };
const SLOTS = 12;
const PUNCH_UP = 24, PUNCH_DOWN = Z0 + COIN_H + 0.6;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [GATE_X, 0, 86], [DIAL[0], DIAL[1], DIAL_TOP + 4]],
  W, H, { pad: 8, azimuth: 56, elevation: 38 },
);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const box = (plan, z, h, tone = "mid", opts = {}) => S(k.slabOf(plan, z, h, P, 4, opts.bevel ?? 0.5), { tone, ...opts.style });
const dots = (pts, z, size = 0.45) => D(pts.map(([x, y]) => at([x, y, z])), { size });
const label = (x, y, z, text, size = 7.2) => k.faceTextSvg(k.topMatrix([x, y], z, P, "x"), text, { size, tone: "mid", anchor: "start" });

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  const strip = { x: PLATE.x + 14, y: PLATE.y + 8, w: 120, d: 6, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.4], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function plates() {
  const out = [];
  const specs = [
    { x: -228, text: "LaserStream", w: 78 },
    { x: -58, text: "creditDeposit()", w: 98 },
    { x: 62, text: "Ledger (SQLite)", w: 112 },
  ];
  for (const s of specs) {
    const plan = { x: s.x, y: 60, w: s.w, d: 16, r: 2 };
    out.push(S(k.slabOf(plan, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
    out.push(L(k.planOutline(k.insetPlan(plan, 1.6), 0.8, P, 3), { tone: "faint" }));
    out.push(label(s.x + 6, 71.4, 0.8, s.text, 7.4));
    out.push(dots([[s.x + 2.6, 62.6], [s.x + s.w - 2.6, 62.6], [s.x + 2.6, 73.4], [s.x + s.w - 2.6, 73.4]], 0.8, 0.4));
  }
  return out.join("");
}

function rail() {
  const out = [];
  const bed = { x: RAIL.from, y: -12, w: RAIL.to - RAIL.from, d: 24, r: 1 };
  out.push(S(k.slabOf(bed, 0, Z0, P, 3, 0.5), { tone: "mid" }));
  for (let x = RAIL.from + 14; x < RAIL.to - 8; x += 24) out.push(L(k.lineOnTop([x, -12], [x, 12], Z0, P), { tone: "faint" }));
  out.push(L(k.lineOnTop([RAIL.from, 0], [RAIL.to, 0], Z0, P), { tone: "faint", dashed: true }));
  return out.join("");
}
const guide = (x0, x1, y) => box({ x: x0, y, w: x1 - x0, d: 2.4, r: 0.6 }, Z0, 4, "mid", { bevel: 0.3 });

function hopper() {
  const out = [];
  const body = { x: -228, y: -30, w: 62, d: 60, r: 4 };
  out.push(`<path class="iso-halo" d="${k.haloOf(body, 0, 20, P)}" style="filter:blur(5px)"/>`);
  out.push(box(body, 0, 44, "mid", { bevel: 0.8 }));
  out.push(box(k.insetPlan(body, 2), 44, 6, "mid", { bevel: 0.6 }));
  out.push(L(k.planOutline(k.insetPlan(body, 6), 50, P, 4), { tone: "faint" }));
  for (let i = 0; i < 5; i++) out.push(L(k.lineOnTop([body.x + 10 + i * 8, body.y + 10], [body.x + 10 + i * 8, body.y + 50], 50, P), { tone: "faint" }));
  out.push(dots([[body.x + 6, body.y + 6], [body.x + body.w - 6, body.y + 6], [body.x + 6, body.y + body.d - 6], [body.x + body.w - 6, body.y + body.d - 6]], 50, 0.5));
  const spout = { x: -170, y: -10, w: 20, d: 20, r: 2 };
  out.push(box(spout, Z0, 14, "mid", { bevel: 0.5 }));
  out.push(L(k.planOutline(k.insetPlan(spout, 3), Z0 + 14, P, 3), { tone: "faint" }));
  out.push(S(k.cylinder(-198, 31.5, 2.2, 28, 1.2, P, 16), { tone: "lit", lit: true }));
  return out.join("");
}

function rack() {
  const out = [];
  out.push(box(RACK, 0, 22, "mid", { bevel: 0.6 }));
  out.push(box(k.insetPlan(RACK, 1.2), 22, 2, "mid", { bevel: 0.4 }));
  for (let i = 0; i < SLOTS; i++) {
    const x = RACK.x + 6 + i * ((RACK.w - 12) / (SLOTS - 1));
    out.push(L(k.rise([x, RACK.y + RACK.d], 5, 17, P), { tone: "lo" }));
  }
  out.push(L(k.lineOnTop([RACK.x + 4, RACK.y + 6], [RACK.x + RACK.w - 4, RACK.y + 6], 24, P), { tone: "faint" }));
  out.push(dots([[RACK.x + 3, RACK.y + 3], [RACK.x + RACK.w - 3, RACK.y + 3]], 24, 0.45));
  return out.join("");
}
const slotX = (i) => RACK.x + 6 + i * ((RACK.w - 12) / (SLOTS - 1));
function stubs() {
  return Array.from({ length: SLOTS }, (_, i) => {
    const x = slotX(i);
    return `<g class="stub" data-slot="${i}">${S(k.slabOf({ x: x - 1.3, y: RACK.y + RACK.d, w: 2.6, d: 3.4, r: 0.4 }, 6, 11, P, 2, 0.2), { tone: "lit", lit: true, crease: "none" })}</g>`;
  }).join("");
}

const POST_Y = [-30, 22];
function gateBack() {
  return box({ x: GATE_X - 5, y: POST_Y[0], w: 10, d: 8, r: 1.5 }, 0, 60, "mid", { bevel: 0.6 }) +
    box({ x: GATE_X - 7, y: POST_Y[0] - 2, w: 14, d: 12, r: 2 }, 0, 4, "lo", { bevel: 0.4 });
}
function gateFront() {
  const out = [];
  out.push(box({ x: GATE_X - 5, y: POST_Y[1], w: 10, d: 8, r: 1.5 }, 0, 60, "mid", { bevel: 0.6 }));
  out.push(box({ x: GATE_X - 7, y: POST_Y[1] - 2, w: 14, d: 12, r: 2 }, 0, 4, "lo", { bevel: 0.4 }));
  out.push(dots([[GATE_X - 4, POST_Y[1] + 9.5], [GATE_X + 4, POST_Y[1] + 9.5]], 4, 0.4));
  return out.join("");
}
function gateBeam() {
  const out = [];
  const beam = { x: GATE_X - 6, y: -34, w: 12, d: 68, r: 2 };
  out.push(box(beam, 54, 10, "mid", { bevel: 0.7 }));
  out.push(L(k.lineOnTop([GATE_X, -30], [GATE_X, 30], 64, P), { tone: "faint" }));
  out.push(dots([[GATE_X, -29], [GATE_X, 29]], 64, 0.5));
  const sol = { x: GATE_X - 9, y: -12, w: 18, d: 24, r: 3 };
  out.push(box(sol, 64, 18, "hi", { bevel: 0.8, style: { crease: "lo" } }));
  for (let i = 0; i < 4; i++) out.push(L(k.lineOnTop([sol.x + 2, sol.y + 5 + i * 4.6], [sol.x + sol.w - 2, sol.y + 5 + i * 4.6], 82, P), { tone: "faint" }));
  out.push(S(k.cylinder(GATE_X, 0, 3.4, 82, 3, P, 20), { tone: "mid" }));
  out.push(D([at([GATE_X, 8.5, 82]), at([GATE_X, -8.5, 82])], { size: 0.5, tone: "hi" }));
  out.push(S(k.cylinder(GATE_X, 25, 1.9, 82, 1.2, P, 14), { tone: "lit", lit: true }));
  return out.join("");
}
function punch() {
  const out = [];
  out.push(S(k.cylinder(GATE_X, 0, 2, PUNCH_UP + 3, 54 - PUNCH_UP - 3, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(GATE_X, 0, 6.8, PUNCH_UP, 3, P, 28, 0.5), { tone: "lit", lit: true }));
  out.push(L(k.ring(GATE_X, 0, 4.2, PUNCH_UP + 3, P, 20), { tone: "lo" }));
  return out.join("");
}

function trayOf(t, hostName) {
  const back = [];
  const front = [];
  back.push(box({ x: t.x, y: t.y, w: t.w, d: t.d, r: 2 }, 0, 2.4, "lo", { bevel: 0.4 }));
  back.push(box({ x: t.x, y: t.y, w: 2.6, d: t.d, r: 0.8 }, 2.4, 8, "mid", { bevel: 0.3 }));
  back.push(box({ x: t.x + t.w - 2.6, y: t.y, w: 2.6, d: t.d, r: 0.8 }, 2.4, 8, "mid", { bevel: 0.3 }));
  front.push(box({ x: t.x, y: t.y + t.d - 2.6, w: t.w, d: 2.6, r: 0.8 }, 2.4, 8, "mid", { bevel: 0.3 }));
  front.push(dots([[t.x + 5, t.y + t.d - 1.3], [t.x + t.w - 5, t.y + t.d - 1.3]], 8, 0.4));
  return { back: back.join(""), front: front.join(""), name: hostName };
}

function bin() {
  const back = [], front = [];
  back.push(`<path class="iso-halo" d="${k.haloOf(BIN, 0, 20, P)}" style="filter:blur(6px)"/>`);
  back.push(box(BIN, 0, 3, "lo", { bevel: 0.4 }));
  back.push(box({ x: BIN.x, y: BIN.y, w: BIN.w, d: 4, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  back.push(box({ x: BIN.x + BIN.w - 4, y: BIN.y, w: 4, d: BIN.d, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  back.push(box({ x: BIN.x, y: BIN.y, w: 4, d: 22, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  front.push(box({ x: BIN.x, y: 12, w: 4, d: BIN.y + BIN.d - 12, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  front.push(box({ x: BIN.x, y: BIN.y + BIN.d - 4, w: BIN.w, d: 4, r: 1 }, 3, 30, "mid", { bevel: 0.6 }));
  front.push(L(k.planOutline(k.insetPlan({ x: BIN.x + 4, y: BIN.y + BIN.d - 4, w: BIN.w - 8, d: 4, r: 0.5 }, 0.8), 33, P, 3), { tone: "faint" }));
  front.push(dots([[BIN.x + 8, BIN.y + BIN.d - 2], [BIN.x + BIN.w - 8, BIN.y + BIN.d - 2]], 33, 0.4));
  return { back: back.join(""), front: front.join("") };
}

function counter() {
  const out = [];
  out.push(box(COUNTER, 0, DIAL_Z, "mid", { bevel: 0.8 }));
  out.push(box(k.insetPlan(COUNTER, 2), DIAL_Z, 6, "hi", { bevel: 0.6, style: { crease: "lo" } }));
  const [x, y] = DIAL;
  out.push(S(k.cylinder(x, y, DIAL_R - 2, DIAL_TOP, 0.8, P, 48), { tone: "mid", crease: "none" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.2, DIAL_TOP + 0.8, P, 48), { tone: "lo" }));
  const t = k.radialTicks(x, y, DIAL_R - 3.4, 50, 5, DIAL_TOP + 0.8, [1.2, 2.6], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(dots([[COUNTER.x + 4, COUNTER.y + 4], [COUNTER.x + COUNTER.w - 4, COUNTER.y + 4], [COUNTER.x + 4, COUNTER.y + COUNTER.d - 4], [COUNTER.x + COUNTER.w - 4, COUNTER.y + COUNTER.d - 4]], DIAL_TOP, 0.45));
  return out.join("");
}

function flap(open) {
  // open: lies along the rail. closed: swung across to push a coin to the front tray.
  const hinge = [FLAP_X, -11];
  const len = 26;
  const ang = open ? 0 : 1.05;
  const ring = [[0, 0], [len, 0], [len, 2.2], [0, 2.2]].map(([a, b]) => [hinge[0] + a * Math.cos(ang) - b * Math.sin(ang), hinge[1] + a * Math.sin(ang) + b * Math.cos(ang)]);
  return `<g class="flap" data-open="${open ? 1 : 0}">${S(k.extrude(ring, Z0, 9, P, { convex: true, bevel: 0.3 }), { tone: "hi", lit: !open })}${S(k.cylinder(hinge[0], hinge[1] + 1, 2.6, Z0, 10, P, 14), { tone: "mid" })}</g>`;
}

const coin = `<g class="coin">${S(k.cylinder(0, 0, COIN_R, 0, COIN_H, P, 28, 0.4), { tone: "lit", lit: true, crease: "none" })}${L(k.ring(0, 0, COIN_R - 1.8, COIN_H, P, 24), { tone: "faint" })}</g>`;
const dialNeedle = (turn) => {
  const a = turn * Math.PI * 2, [x, y] = DIAL;
  return k.lineOnTop([x - Math.sin(a) * 2.6, y + Math.cos(a) * 2.6], [x + Math.sin(a) * (DIAL_R - 4), y - Math.cos(a) * (DIAL_R - 4)], DIAL_TOP + 1, P);
};

const ign = trayOf(IGN, "ignored");
const dup = trayOf(DUP, "duplicate");
const binParts = bin();

const svg = k.figureSvg({
  width: W,
  height: H,
  label: "A deposit machine on a base plate. Tokens slide out of a LaserStream hopper along a rail. Under a gate, a punch checks each one against a rack of stubs. New tokens carry on into the ledger bin and a dial counts them. Repeats are swung by a flap into a skipped tray. Tokens that are not deposits drop into an ignored tray before the gate.",
  body: [
    base(), plates(), rail(), guide(RAIL.from, RAIL.to, -13.4), hopper(), rack(), `<g id="stubs">${stubs()}</g>`,
    gateBack(), ign.back, dup.back, binParts.back, counter(),
    `<path id="needle" class="iso-line" data-tone="lit" d="${dialNeedle(0)}" style="stroke-width:1.1"/>`,
    `<g id="coins"></g>`,
    `<g id="punch">${punch()}</g>`,
    gateBeam(), gateFront(),
    guide(RAIL.from, -124, 11), guide(-100, 16, 11), guide(48, RAIL.to, 11),
    `<g id="flaps">${flap(true)}${flap(false)}</g>`,
    ign.front, dup.front, binParts.front,
  ],
});

const meta = {
  P, W, H, Z0, COIN_R, COIN_H, GATE_X, FLAP_X, PUNCH_UP, PUNCH_DOWN, SLOTS,
  rail: RAIL, ign: IGN, dup: DUP, bin: BIN, dial: DIAL, dialR: DIAL_R, dialTop: DIAL_TOP,
  spawn: [RAIL.from + 14, 0, Z0], coin,
  anchors: {
    ignored: at([IGN.x + IGN.w / 2, IGN.y, 22]),
    duplicate: at([DUP.x + DUP.w / 2, DUP.y, 22]),
    credited: at([BIN.x + BIN.w / 2, BIN.y + BIN.d / 2, 40]),
  },
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "machine.svg"), svg);
writeFileSync(join(OUT, "machine.json"), JSON.stringify(meta));
console.log("wrote public/machine.svg", (svg.length / 1024).toFixed(0) + " KB,", (svg.match(/class="iso-solid/g) || []).length, "solids");
