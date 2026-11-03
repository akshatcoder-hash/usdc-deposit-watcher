// @ts-nocheck
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const SLOW = Math.max(
    1,
    Math.min(10, Number(new URLSearchParams(location.search).get("slow")) || 1),
  );
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  let M = null,
    svg = null,
    stubCount = 0,
    credits = 0,
    lastDeposit = null,
    saved = null,
    visible = true,
    paused = false,
    replaying = false;
  const slotOf = new Map(),
    timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms * SLOW);
    timers.add(timer);
    return timer;
  };
  /* camera: same formula as the drawing */
  const cam = () => {
    const a = (M.P.azimuth * Math.PI) / 180,
      e = (M.P.elevation * Math.PI) / 180,
      k = M.P.scale * Math.sqrt(1.6);
    return {
      sa: Math.sin(a),
      ca: Math.cos(a),
      se: Math.sin(e),
      ce: Math.cos(e),
      k,
    };
  };
  const iso = ([x, y, z]) => {
    const c = cam();
    return [
      M.P.origin[0] + (x * c.sa - y * c.ca) * c.k,
      M.P.origin[1] + ((x * c.ca + y * c.sa) * c.se - z * c.ce) * c.k,
    ];
  };
  const shift = (p) => {
    const a = iso(p),
      o = iso([0, 0, 0]);
    return `translate(${(a[0] - o[0]).toFixed(2)} ${(a[1] - o[1]).toFixed(2)})`;
  };

  /* easing */
  const bez = (x1, y1, x2, y2) => (x) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const cx =
        3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3 - x;
      const d =
        3 * x1 * (1 - t) ** 2 +
        6 * (x2 - x1) * t * (1 - t) +
        3 * (1 - x2) * t * t;
      if (Math.abs(d) < 1e-6) break;
      t -= cx / d;
    }
    return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  };
  const EASE = {
    out: bez(0.23, 1, 0.32, 1),
    inOut: bez(0.77, 0, 0.175, 1),
    lin: (t) => t,
  };

  /* one rAF loop drives every moving part, and sleeps when nothing moves */
  const actors = new Set();
  let raf = 0;
  function loop(now) {
    for (const a of [...actors]) if (a(now) === false) actors.delete(a);
    raf = actors.size ? requestAnimationFrame(loop) : 0;
  }
  const run = (fn) => {
    actors.add(fn);
    if (!raf) raf = requestAnimationFrame(loop);
  };

  function timeline(keys, apply, done) {
    const t0 = performance.now();
    run((now) => {
      const t = (now - t0) / SLOW;
      let i = 0;
      while (i < keys.length - 2 && t > keys[i + 1].t) i++;
      const a = keys[i],
        b = keys[i + 1];
      const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
      const f = EASE[b.ease || "inOut"](k);
      apply({
        p: a.p.map((v, j) => v + (b.p[j] - v) * f),
        o: a.o + (b.o - a.o) * f,
      });
      if (t >= keys[keys.length - 1].t) {
        done && done();
        return false;
      }
    });
  }

  function flapState(closed) {
    closed
      ? $("flaps").setAttribute("data-closed", "")
      : $("flaps").removeAttribute("data-closed");
  }
  function punchCycle(reject) {
    const g = svg.querySelector("#punch"),
      up = M.PUNCH_UP,
      dn = M.PUNCH_DOWN;
    const keys = reject
      ? [
          { t: 0, p: [0, 0, up], o: 1 },
          { t: 110, p: [0, 0, dn + 3], o: 1, ease: "out" },
          { t: 170, p: [0, 0, dn + 3], o: 1 },
          { t: 330, p: [0, 0, up], o: 1, ease: "out" },
        ]
      : [
          { t: 0, p: [0, 0, up], o: 1 },
          { t: 140, p: [0, 0, dn], o: 1, ease: "out" },
          { t: 260, p: [0, 0, dn], o: 1 },
          { t: 480, p: [0, 0, up], o: 1, ease: "out" },
        ];
    timeline(keys, ({ p }) =>
      g.setAttribute("transform", shift([0, 0, p[2] - up])),
    );
  }

  function tag(kind, text, delay = 0) {
    later(() => {
      $("machine-readout").textContent = (replaying ? "Replay · " : "") + text;
    }, delay);
  }

  function launchCoin(e) {
    const g = document.createElementNS(NS, "g");
    g.innerHTML = M.coin;
    const coin = g.firstChild;
    svg.querySelector("#coins").appendChild(coin);
    const [sx, sy, sz] = M.spawn,
      gx = M.GATE_X,
      z = M.Z0;
    const set = ({ p, o }) => {
      coin.setAttribute("transform", shift(p));
      coin.style.opacity = o;
    };
    const fin = () => coin.remove();
    const ground = (kind) => coin.setAttribute("data-kind", kind);
    const bin = M.bin,
      dup = M.dup,
      ign = M.ign;
    if (e.action === "credited") {
      later(() => ground("credited"), 880);
      later(() => punchCycle(false), 780);
      if (!slotOf.has(e.signature)) {
        const s = stubCount++ % M.SLOTS;
        for (const [sig, v] of slotOf) if (v === s) slotOf.delete(sig);
        slotOf.set(e.signature, s);
        later(() => setStub(s, true), 900);
      }
      later(() => {
        tag("credited", "credited +" + Number(e.amount).toFixed(2));
      }, 2150);
      timeline(
        [
          { t: 0, p: [sx, 0, z], o: 0 },
          { t: 160, p: [sx + 8, 0, z], o: 1, ease: "out" },
          { t: 820, p: [gx, 0, z], o: 1 },
          { t: 1300, p: [gx, 0, z], o: 1 },
          { t: 1980, p: [bin.x + 2, 0, z], o: 1 },
          { t: 2260, p: [bin.x + 16, 0, z], o: 1, ease: "out" },
          { t: 2640, p: [bin.x + 18, 0, 3.4], o: 0, ease: "out" },
        ],
        set,
        () => {
          fin();
          landCredit(e);
        },
      );
    } else if (e.action === "duplicate") {
      const hit = slotOf.get(e.signature);
      later(() => ground("duplicate"), 880);
      later(() => punchCycle(true), 780);
      if (hit !== undefined)
        later(() => {
          setHit(hit, true);
          later(() => setHit(hit, false), 1100);
        }, 860);
      later(() => flapState(true), 1150);
      later(() => tag("duplicate", "duplicate, skipped"), 2100);
      later(() => flapState(false), 3000);
      timeline(
        [
          { t: 0, p: [sx, 0, z], o: 0 },
          { t: 160, p: [sx + 8, 0, z], o: 1, ease: "out" },
          { t: 820, p: [gx, 0, z], o: 1 },
          { t: 880, p: [gx - 1.4, 0, z], o: 1, ease: "out" },
          { t: 940, p: [gx + 1, 0, z], o: 1, ease: "out" },
          { t: 1300, p: [gx, 0, z], o: 1 },
          { t: 1760, p: [M.FLAP_X + 4, 0, z], o: 1 },
          { t: 2260, p: [dup.x + 14, dup.y + 6, z], o: 1, ease: "out" },
          { t: 2560, p: [dup.x + 14, dup.y + 14, 2.4], o: 1, ease: "out" },
          { t: 3100, p: [dup.x + 14, dup.y + 14, 2.4], o: 0 },
        ],
        set,
        fin,
      );
    } else {
      later(() => ground("ignored"), 650);
      later(() => tag("ignored", "ignored"), 1250);
      const x = ign.x + ign.w / 2;
      timeline(
        [
          { t: 0, p: [sx, 0, z], o: 0 },
          { t: 160, p: [sx + 8, 0, z], o: 1, ease: "out" },
          { t: 700, p: [x, 0, z], o: 1 },
          { t: 1180, p: [x, ign.y + 12, z], o: 1, ease: "out" },
          { t: 1380, p: [x, ign.y + 14, 2.4], o: 1, ease: "out" },
          { t: 1900, p: [x, ign.y + 14, 2.4], o: 0 },
        ],
        set,
        fin,
      );
    }
  }

  function drawNeedle(turn) {
    const a = turn * Math.PI * 2,
      [x, y] = M.dial,
      r = M.dialR,
      z = M.dialTop + 1;
    const p = (px, py) =>
      iso([px, py, z])
        .map((v) => v.toFixed(1))
        .join(" ");
    svg
      .querySelector("#needle")
      .setAttribute(
        "d",
        `M${p(x - Math.sin(a) * 2.6, y + Math.cos(a) * 2.6)}L${p(x + Math.sin(a) * (r - 4), y - Math.cos(a) * (r - 4))}`,
      );
  }
  const setStub = (i, on) => {
    const el = svg.querySelector(`.stub[data-slot="${i}"]`);
    on ? el.setAttribute("data-on", "") : el.removeAttribute("data-on");
  };
  const setHit = (i, on) => {
    const el = svg.querySelector(`.stub[data-slot="${i}"]`);
    on ? el.setAttribute("data-hit", "") : el.removeAttribute("data-hit");
  };

  function landCredit() {
    drawNeedle(credits / 10);
  }
  function cancelMotion() {
    cancelAnimationFrame(raf);
    raf = 0;
    actors.clear();
    timers.forEach(clearTimeout);
    timers.clear();
    if (!svg) return;
    svg.querySelector("#coins").replaceChildren();
    svg.querySelector("#punch").removeAttribute("transform");
    flapState(false);
    svg
      .querySelectorAll("[data-hit]")
      .forEach((e) => e.removeAttribute("data-hit"));
  }
  function sync(data) {
    saved = data;
    const deposits = data.recent.filter((e) => e.action === "credited");
    if (deposits.length) lastDeposit = deposits[deposits.length - 1];
    credits = data.stats.credited;
    if (!M || paused) return;
    for (const sig of data.signatures) {
      if (slotOf.has(sig)) continue;
      const index = stubCount++ % M.SLOTS;
      for (const [key, value] of slotOf)
        if (value === index) slotOf.delete(key);
      slotOf.set(sig, index);
      setStub(index, true);
    }
    drawNeedle(credits / 10);
    $("replay-animation").disabled = !lastDeposit || paused;
  }
  function play(event, replay = false) {
    if (event.action === "credited") lastDeposit = event;
    if (!M || paused) return;
    cancelMotion();
    replaying = replay;
    $("machine-readout").textContent =
      (replay ? "Replay · " : "") +
      {
        credited: "USDC deposit entering the ledger",
        duplicate: "Checking a repeated signature",
        ignored: "Checking a non-deposit transaction",
      }[event.action];
    const bounds = $("machine").getBoundingClientRect();
    const onScreen = bounds.bottom > 0 && bounds.top < innerHeight;
    if (still.matches || !onScreen || document.hidden) {
      tag(
        event.action,
        {
          credited: "Deposit credited once",
          duplicate: "Duplicate skipped",
          ignored: "Transaction ignored",
        }[event.action],
      );
      if (saved) sync(saved);
      return;
    }
    launchCoin(event);
  }
  async function boot() {
    $("machine-loading").textContent = "Loading machine…";
    try {
      const [meta, markup] = await Promise.all([
        fetch("/machine.json", { signal: AbortSignal.timeout(5000) }).then(
          (r) => {
            if (!r.ok) throw Error("metadata");
            return r.json();
          },
        ),
        fetch("/machine.svg", { signal: AbortSignal.timeout(5000) }).then(
          (r) => {
            if (!r.ok) throw Error("drawing");
            return r.text();
          },
        ),
      ]);
      M = meta;
      $("machine").insertAdjacentHTML("beforeend", markup);
      svg = $("machine").querySelector("svg");
      $("machine-loading").remove();
      if (saved) sync(saved);
    } catch {
      const note = $("machine-loading");
      note.textContent = "The machine could not load. ";
      const retry = document.createElement("button");
      retry.textContent = "Retry drawing";
      retry.addEventListener("click", boot);
      note.append(retry);
    }
  }
  $("replay-animation").addEventListener("click", () => {
    if (!lastDeposit) return;
    $("machine").scrollIntoView({ block: "center", behavior: "instant" });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => play(lastDeposit, true)),
    );
  });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible) cancelMotion();
  }).observe($("machine"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelMotion();
  });
  still.addEventListener("change", () => {
    if (still.matches) cancelMotion();
  });
  window.depositMachine = {
    sync,
    play,
    pause(value) {
      paused = value;
      cancelMotion();
      $("replay-animation").disabled = paused || !lastDeposit;
      if (!paused && saved) sync(saved);
    },
  };
  void boot();
})();
