/**
 * Minimaler Client für die Cloudflare-D1-HTTP-API.
 * Benötigt die Umgebungsvariablen CF_ACCOUNT_ID, CF_API_TOKEN, D1_DATABASE_ID.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function endpoint() {
  const { CF_ACCOUNT_ID, D1_DATABASE_ID } = process.env;
  if (!CF_ACCOUNT_ID || !D1_DATABASE_ID || !process.env.CF_API_TOKEN) {
    throw new Error('CF_ACCOUNT_ID, CF_API_TOKEN und D1_DATABASE_ID müssen gesetzt sein.');
  }
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;
}

async function post(body) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(endpoint(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`D1: keine JSON-Antwort (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`D1: HTTP ${res.status}`);
      if (!json.success) {
        const msg = (json.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
        const err = new Error(`D1-Fehler: ${msg}`);
        err.fatal = true;
        throw err;
      }
      return json.result;
    } catch (e) {
      lastError = e;
      if (e.fatal) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError;
}

/** Einzelne Abfrage, liefert die Zeilen */
export async function d1(sql, params = []) {
  const result = await post({ sql, params });
  return result[0]?.results ?? [];
}

/** Mehrere Anweisungen; fällt bei Problemen auf Einzelaufrufe zurück */
export async function d1Batch(statements, chunkSize = 20) {
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    try {
      await post({ batch: chunk.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
    } catch (e) {
      console.warn(`Batch fehlgeschlagen (${e.message}) – sende Einzelanweisungen.`);
      for (const s of chunk) await d1(s.sql, s.params ?? []);
    }
  }
}

export function d1Configured() {
  return Boolean(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN && process.env.D1_DATABASE_ID);
}
