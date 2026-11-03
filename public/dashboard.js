// @ts-nocheck
(() => {
  const $ = (id) => document.getElementById(id);
  let state = null,
    connected = false,
    paused = false,
    pending = false,
    stream = null,
    events = [];
  let lastState = "",
    lastSnapshot = 0,
    requestId = 0,
    reconnectTimer;
  const announce = (message) => {
    $("announcer").textContent = message;
  };
  const notice = (message) => {
    $("notice").textContent = message;
    $("notice").hidden = !message;
  };
  const money = (value) =>
    Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  const short = (value) => value.slice(0, 6) + "…" + value.slice(-5);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  let theme = "light";
  try {
    theme =
      localStorage.getItem("deposit-watcher-theme") === "dark"
        ? "dark"
        : "light";
  } catch {}
  function setTheme() {
    document.documentElement.dataset.theme = theme;
    $("theme").textContent = theme === "dark" ? "Light mode" : "Dark mode";
    try {
      localStorage.setItem("deposit-watcher-theme", theme);
    } catch {}
  }
  setTheme();
  $("theme").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    setTheme();
  });
  function renderStatus() {
    const s = state?.status;
    const mode = !connected ? "offline" : (s?.state ?? "replaying");
    const labels = {
      live: "Stream live",
      dropped: "Stream dropped",
      replaying: "Catching up",
      offline: "Dashboard reconnecting",
    };
    $("connection").dataset.state = mode;
    $("connection-label").textContent = labels[mode];
    $("drop").disabled =
      !connected || !state || pending || mode === "replaying";
    $("drop").dataset.dropped = String(mode === "dropped");
    $("drop").textContent = pending
      ? "Working…"
      : mode === "dropped"
        ? "Reconnect"
        : `Drop stream · ${state?.dropHoldSeconds ?? 30}s`;
    if (lastState && lastState !== mode) announce(labels[mode]);
    lastState = mode;
  }
  function renderRows(fresh = false) {
    const body = $("transactions");
    body.replaceChildren();
    if (!events.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 3;
      cell.className = "empty";
      cell.textContent = "No transactions yet.";
      return;
    }
    events.slice(0, 10).forEach((event, index) => {
      const row = body.insertRow();
      if (fresh && index === 0) row.className = "fresh";
      const first = row.insertCell();
      const link = document.createElement("a");
      link.className = "transaction-link";
      link.textContent = short(event.signature) + " ↗";
      link.href = `https://explorer.solana.com/tx/${encodeURIComponent(event.signature)}${state?.explorerSuffix ?? "?cluster=devnet"}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.title = event.signature;
      link.setAttribute(
        "aria-label",
        `View transaction ${event.signature} in Solana Explorer`,
      );
      first.append(link);
      const meta = document.createElement("div");
      meta.className = "tx-meta";
      meta.textContent = `${time.format(event.t)} · ${event.source}`;
      first.append(meta);
      const amount = row.insertCell();
      amount.className = "numeric";
      amount.textContent = event.amount
        ? `${event.action === "credited" ? "+" : ""}${money(event.amount)}`
        : "—";
      const result = row.insertCell();
      const badge = document.createElement("span");
      badge.className = `result ${event.action}`;
      badge.textContent =
        { credited: "Credited", duplicate: "Skipped", ignored: "Ignored" }[
          event.action
        ] ?? event.action;
      result.append(badge);
    });
  }
  function render(fresh = false) {
    if (!state) return;
    renderStatus();
    if (paused) return;
    $("balance").textContent =
      state.balance === null ? "—" : money(state.balance);
    $("balance-status").hidden = state.balance !== null;
    $("network").textContent = state.network;
    $("wallet").textContent = state.wallet;
    $("wallet").href =
      `https://explorer.solana.com/address/${state.wallet}${state.explorerSuffix}`;
    $("wallet").target = "_blank";
    $("wallet").rel = "noopener noreferrer";
    $("copy").disabled = false;
    renderRows(fresh);
    window.depositMachine?.sync(state);
  }
  function snapshot(data) {
    state = data;
    events = [...data.recent].reverse();
    render();
  }
  async function refresh() {
    const started = ++requestId,
      stamp = lastSnapshot;
    try {
      const response = await fetch("/api/state", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("state");
      const data = await response.json();
      if (started === requestId && stamp === lastSnapshot && !connected)
        snapshot(data);
    } catch {
      if (!state)
        notice(
          "Watcher unavailable. Run bun run dashboard; this page retries automatically.",
        );
    }
  }
  function connect() {
    if (!("EventSource" in window)) {
      notice(
        "Live streaming is unavailable in this browser. Saved data refreshes every 10 seconds.",
      );
      return;
    }
    clearTimeout(reconnectTimer);
    stream?.close();
    stream = new EventSource("/events");
    stream.addEventListener("snapshot", (e) => {
      connected = true;
      lastSnapshot++;
      notice("");
      snapshot(JSON.parse(e.data));
    });
    stream.addEventListener("status", (e) => {
      if (state) {
        state.status = JSON.parse(e.data);
        renderStatus();
      }
    });
    stream.addEventListener("balance", (e) => {
      if (state) {
        state.balance = JSON.parse(e.data).usdc;
        render();
      }
    });
    stream.addEventListener("stats", (e) => {
      if (state) {
        state.stats = JSON.parse(e.data);
        render();
      }
    });
    stream.addEventListener("tx", (e) => {
      const event = JSON.parse(e.data);
      events.unshift(event);
      events.length = Math.min(events.length, 10);
      if (state) {
        state.recent = [...events].reverse();
        if (
          event.action === "credited" &&
          !state.signatures.includes(event.signature)
        )
          state.signatures = [...state.signatures, event.signature].slice(-12);
      }
      render(true);
      if (paused) return;
      const label =
        event.action === "credited"
          ? `Credited ${money(event.amount)} USDC`
          : event.action === "duplicate"
            ? "Duplicate skipped."
            : "Transaction ignored.";
      announce(label);
      window.depositMachine?.play(event);
    });
    stream.onerror = () => {
      stream.close();
      connected = false;
      renderStatus();
      notice("Connection lost. Reconnecting…");
      void refresh();
      reconnectTimer = setTimeout(connect, 2000);
    };
  }
  $("copy").addEventListener("click", async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.wallet);
      $("copy").textContent = "Address copied";
      announce("Wallet address copied.");
    } catch {
      notice(
        "Copy is unavailable. Select and copy the full deposit address above.",
      );
    }
  });
  $("pause").addEventListener("click", () => {
    paused = !paused;
    window.depositMachine?.pause(paused);
    $("pause").setAttribute("aria-pressed", String(paused));
    $("pause").textContent = paused ? "Resume updates" : "Pause updates";
    if (!paused) render();
    announce(
      paused
        ? "Display paused. The watcher keeps recording deposits."
        : "Display resumed.",
    );
  });
  $("drop").addEventListener("click", async () => {
    if (pending || !connected || !state) return;
    const endpoint = state.status.state === "dropped" ? "/reconnect" : "/drop";
    pending = true;
    renderStatus();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("request");
      notice("");
    } catch {
      notice(
        "The stream action did not complete. Check the connection and try again.",
      );
    } finally {
      pending = false;
      renderStatus();
    }
  });
  void refresh();
  connect();
  setInterval(() => {
    if (!connected) void refresh();
  }, 10000);
})();
