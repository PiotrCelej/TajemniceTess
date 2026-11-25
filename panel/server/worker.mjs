const htmlHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin"
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function progress(request, db, url) {
  const owner = request.headers.get("oai-authenticated-user-id");
  if (!owner) return json({ error: "Wymagane zalogowanie do ChatGPT." }, 401);
  if (!db) return json({ error: "Baza zapisu jest chwilowo niedostępna." }, 503);

  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT key, value FROM campaign_progress WHERE owner_id = ?")
      .bind(owner).all();
    return json({ entries: Object.fromEntries(results.map(row => [row.key, JSON.parse(row.value)])) });
  }

  if (request.method !== "PATCH") return json({ error: "Niedozwolona metoda." }, 405);
  if (!request.headers.get("content-type")?.startsWith("application/json") ||
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.get("origin") && request.headers.get("origin") !== url.origin)) {
    return json({ error: "Nieprawidłowe żądanie." }, 403);
  }
  const raw = await request.text();
  if (raw.length > 1024 * 1024) return json({ error: "Zapis jest za duży." }, 413);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Nieprawidłowy format zapisu." }, 400);
  }
  const entries = body?.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries) ||
      (body.mode !== undefined && body.mode !== "merge")) {
    return json({ error: "Nieprawidłowy format zapisu." }, 400);
  }
  const changes = Object.entries(entries);
  if (changes.length > 1500 || !changes.every(([key, value]) => validProgressEntry(key, value))) {
    return json({ error: "Nieprawidłowa wartość w zapisie." }, 400);
  }

  if (changes.length) {
    const rows = changes.map(([key, value]) => ({ key, value: JSON.stringify(value) }));
    const conflict = body.mode === "merge" ? "DO NOTHING" : "DO UPDATE SET value = excluded.value";
    const sql = `INSERT INTO campaign_progress (owner_id, key, value)
      SELECT ?, value ->> '$.key', value ->> '$.value' FROM json_each(?) WHERE true
      ON CONFLICT(owner_id, key) ${conflict}`;
    await db.prepare(sql).bind(owner, JSON.stringify(rows)).run();
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/progress") {
      try {
        return await progress(request, env.DB, url);
      } catch (error) {
        console.error("campaign_progress", error.message);
        return json({ error: "Zapis jest chwilowo niedostępny." }, 503);
      }
    }
    const asset = assets.get(url.pathname);
    if (!asset) return new Response("Nie znaleziono strony.", { status: 404 });
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    return new Response(request.method === "HEAD" ? null : asset.body, {
      headers: { ...htmlHeaders, "Content-Type": asset.type, "Cache-Control": "no-cache" }
    });
  }
};
