function createProgressStore({ onData, onStatus }) {
  let remote = {};
  let pending = {};
  let busy = false;
  let writing = false;
  let ready = false;
  let timer;
  let failed = false;

  const snapshot = () => ({ ...remote, ...pending });
  const dirty = () => Object.keys(pending).length > 0;
  const publish = () => onData(snapshot());
  const report = (message, retry = false) => onStatus(message, retry);

  async function api(method, body) {
    const response = await fetch("/api/progress", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Błąd zapisu.");
    return data;
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  async function refresh() {
    if (busy || dirty()) return;
    busy = true;
    if (!ready || failed) report("Łączenie z serwerem…");
    try {
      const { entries } = await api("GET");
      const changed = Object.keys({ ...remote, ...entries }).some(key =>
        JSON.stringify(remote[key]) !== JSON.stringify(entries[key]));
      remote = entries;
      if (!ready || changed) publish();
      ready = true;
      failed = false;
      report("Zsynchronizowano");
    } catch {
      failed = true;
      report("Brak połączenia z zapisem", true);
    } finally {
      busy = false;
      if (dirty()) schedule(0);
    }
  }

  async function flush() {
    clearTimeout(timer);
    if (busy || !dirty()) return;
    busy = true;
    writing = true;
    const sending = pending;
    pending = {};
    const sent = { ...remote, ...sending };
    const previous = remote;
    remote = sent;
    report("Zapisywanie…");
    try {
      await api("PATCH", { entries: sending });
      failed = false;
      report(dirty() ? "Zapisywanie…" : "Zapisano na serwerze");
    } catch {
      remote = previous;
      pending = { ...sending, ...pending };
      failed = true;
      report("Zapis oczekuje na połączenie", true);
    } finally {
      busy = false;
      writing = false;
      if (dirty()) schedule(failed ? 10000 : 0);
    }
  }

  function stage(entries, delay = 0) {
    if (!ready) return;
    pending = { ...pending, ...entries };
    report("Zapisywanie…");
    schedule(delay);
  }

  async function merge(entries) {
    if (!ready || busy || dirty()) throw new Error("Poczekaj na zapis bieżących zmian i spróbuj ponownie.");
    busy = true;
    writing = true;
    report("Przenoszenie zapisu…");
    try {
      await api("PATCH", { entries, mode: "merge" });
      const data = await api("GET");
      remote = data.entries;
      publish();
      failed = false;
      report(dirty() ? "Zapisywanie…" : "Zapisano na serwerze");
    } catch (error) {
      failed = true;
      report("Sprawdź połączenie z serwerem", true);
      throw error;
    } finally {
      busy = false;
      writing = false;
      if (dirty()) schedule(0);
    }
  }

  function retry() {
    return dirty() ? flush() : refresh();
  }

  window.addEventListener("focus", retry);
  window.addEventListener("online", retry);
  window.addEventListener("beforeunload", event => {
    if (!dirty() && !writing) return;
    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" || dirty()) retry();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") retry();
  }, 20000);

  return { snapshot, refresh, stage, merge, retry };
}
