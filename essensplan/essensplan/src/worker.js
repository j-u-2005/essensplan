import rules from '../config/rules.json' with { type: 'json' };
import { rankCandidates, normalizeParams, SLOTS, SLOT_ORDER } from './lib/generator.js';
import { assembleWeek } from './lib/weekdata.js';
import { isValidISO, weekdayIndex, planningWeek } from './lib/dates.js';

const enc = new TextEncoder();
const DAY = 86400000;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const fail = (status, message) => json({ error: message }, status);

// ---------- Anmeldung ----------

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeToken(env) {
  const exp = Date.now() + 30 * DAY;
  return `${exp}.${await hmac(env.SESSION_SECRET, `v1.${exp}`)}`;
}

async function isAuthed(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m || !env.SESSION_SECRET) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, `v1.${exp}`));
}

// ---------- Hilfsfunktionen ----------

const RECIPE_COLS = `id, title, url, image, source, minutes, effort, s_breakfast, s_lunch, s_firma, s_snack, s_dinner,
  cold_ok, micro_ok, shelf_days, batch_ok, sweet, oats, fructose, cost, protein, dtype, leftover_ok, s_firma, rating, blocked`;

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? JSON.parse(row.value) : null;
}

async function getParams(env, week) {
  const defaults = normalizeParams(await getSetting(env, 'defaults'), rules.defaults);
  const plan = await env.DB.prepare('SELECT params FROM plans WHERE week_start = ?').bind(week).first();
  const override = (await getSetting(env, `params:${week}`)) ?? (plan ? JSON.parse(plan.params) : null);
  return { defaults, params: normalizeParams(override, defaults), saved: Boolean(override) };
}

function validWeek(w) {
  return isValidISO(w) && weekdayIndex(w) === 0;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function loadItem(env, id) {
  return env.DB.prepare('SELECT * FROM plan_items WHERE id = ?').bind(id).first();
}

const ITEM_SELECT = `SELECT i.id, i.week_start, i.day, i.slot, i.kind, i.recipe_id, i.title, i.servings, i.note, i.leftover,
  r.title AS recipe_title, r.url, r.image, r.source, r.minutes, r.cold_ok, r.rating
  FROM plan_items i LEFT JOIN recipes r ON r.id = i.recipe_id`;

async function itemView(env, id) {
  return env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(id).first();
}

// ---------- Kandidaten für Austausch ----------

async function candidatesFor(env, item, limit = 10) {
  const { params } = await getParams(env, item.week_start);
  const slot = item.slot;
  const conds = [`s_${slot} = 1`, 'blocked = 0', 'rating >= 0'];
  const binds = [];
  if ((slot === 'breakfast' || slot === 'lunch') && params.brother[item.day]) conds.push('cold_ok = 1');
  if (slot === 'dinner') {
    conds.push('minutes <= ?');
    binds.push(Math.round(rules.dinner_max_minutes * 1.25));
  }
  if (slot === 'snack') {
    conds.push('minutes <= ?');
    binds.push(rules.snack_max_minutes);
  }
  const pool = (
    await env.DB.prepare(`SELECT ${RECIPE_COLS} FROM recipes WHERE ${conds.join(' AND ')} ORDER BY random() LIMIT 150`).bind(...binds).all()
  ).results;

  const others = (
    await env.DB.prepare(
      `SELECT r.id, r.protein, r.dtype, r.source, r.oats, r.effort FROM plan_items i JOIN recipes r ON r.id = i.recipe_id
        WHERE i.week_start = ? AND i.id != ?`,
    ).bind(item.week_start, item.id).all()
  ).results;
  const counts = { protein: {}, dtype: {}, source: {}, effort: 0, effortSet: new Set(), oats: 0 };
  const used = new Set();
  for (const o of others) {
    used.add(o.id);
    if (o.protein !== 'veg') counts.protein[o.protein] = (counts.protein[o.protein] || 0) + 1;
    if (o.dtype !== 'sonstiges') counts.dtype[o.dtype] = (counts.dtype[o.dtype] || 0) + 1;
    counts.source[o.source] = (counts.source[o.source] || 0) + 1;
    if (item.slot !== 'dinner' && !counts.effortSet.has(o.id)) {
      counts.effortSet.add(o.id);
      counts.effort += o.effort;
    }
    if (o.oats) counts.oats += 1;
  }

  return rankCandidates({ pool, slot, day: item.day, params, rules, used, counts, limit });
}

const candidateView = (r) => ({
  id: r.id, title: r.title, url: r.url, image: r.image, source: r.source, minutes: r.minutes, cold_ok: r.cold_ok,
});

// ---------- Woche laden / Firma-Einträge ergänzen ----------

async function loadWeek(env, week) {
  const items = (
    await env.DB.prepare('SELECT id, day, slot, kind, recipe_id, servings, leftover FROM plan_items WHERE week_start = ?').bind(week).all()
  ).results;
  const recipes = (
    await env.DB.prepare(
      `SELECT id, title, url, effort, shelf_days, servings, ingredients FROM recipes
        WHERE id IN (SELECT recipe_id FROM plan_items WHERE week_start = ? AND recipe_id IS NOT NULL)`,
    ).bind(week).all()
  ).results;
  return { items, recipes };
}

/**
 * Für jeden Tag, an dem Papa in der Firma kocht, fehlt ggf. noch ein vorkochbares Gericht.
 * Ergänzt fehlende Firma-Einträge, ohne den restlichen Plan anzufassen, und setzt die
 * Mittags-Portionen an diesen Tagen auf 1 (die Firma bekommt ihr eigenes Gericht).
 */
async function ensureFirma(env, week) {
  const plan = await env.DB.prepare('SELECT week_start FROM plans WHERE week_start = ?').bind(week).first();
  if (!plan) return { added: 0, missing: 0 };
  const { params } = await getParams(env, week);
  const existing = (await env.DB.prepare("SELECT id, day FROM plan_items WHERE week_start = ? AND slot = 'firma'").bind(week).all()).results;
  const have = new Set(existing.map((e) => e.day));
  let added = 0;
  let missing = 0;

  for (let d = 0; d < 5; d++) {
    if (!params.dad_cooks[d]) continue;
    await env.DB.prepare("UPDATE plan_items SET servings = 1 WHERE week_start = ? AND day = ? AND slot = 'lunch' AND leftover = 0 AND kind = 'recipe'").bind(week, d).run();
    if (have.has(d) || params.lunch_extras[d] < 1) continue;
    const cands = await candidatesFor(env, { id: 0, week_start: week, day: d, slot: 'firma' }, 5);
    if (!cands.length) {
      missing++;
      continue;
    }
    const pick = cands[Math.floor(Math.random() * cands.length)];
    await env.DB.prepare("INSERT INTO plan_items (week_start, day, slot, kind, recipe_id, title, servings, note, leftover) VALUES (?,?,'firma','recipe',?,NULL,?,?,0)")
      .bind(week, d, pick.id, params.lunch_extras[d], 'Vorkochen, in der Firma nur aufwärmen').run();
    added++;
  }
  return { added, missing };
}

// ---------- API ----------

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/login' && method === 'POST') {
    if (!env.APP_PASSWORD || !env.SESSION_SECRET) return fail(500, 'APP_PASSWORD und SESSION_SECRET sind nicht gesetzt.');
    const body = await readBody(request);
    const a = await hmac(env.SESSION_SECRET, `pw.${String(body.password ?? '')}`);
    const b = await hmac(env.SESSION_SECRET, `pw.${env.APP_PASSWORD}`);
    if (!safeEqual(a, b)) return fail(401, 'Passwort falsch.');
    const token = await makeToken(env);
    return json({ ok: true }, 200, { 'set-cookie': `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 86400}` });
  }
  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' });
  }

  if (!(await isAuthed(request, env))) return fail(401, 'Nicht angemeldet.');
  if (method !== 'GET' && !(request.headers.get('content-type') || '').includes('application/json')) {
    return fail(415, 'JSON erwartet.');
  }

  if (path === '/api/session' && method === 'GET') return json({ ok: true, current_week: planningWeek() });

  if (path === '/api/weeks' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT week_start, created_at FROM plans ORDER BY week_start DESC LIMIT 30').all()).results;
    return json({ weeks: rows, current_week: planningWeek() });
  }

  if (path === '/api/plan' && method === 'GET') {
    const week = url.searchParams.get('week');
    if (!validWeek(week)) return fail(400, 'Ungültige Woche (Montag als YYYY-MM-DD).');
    const plan = await env.DB.prepare('SELECT week_start, created_at FROM plans WHERE week_start = ?').bind(week).first();
    const items = (
      await env.DB.prepare(
        `${ITEM_SELECT} WHERE i.week_start = ?
         ORDER BY i.day, CASE i.slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'firma' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END, i.id`,
      ).bind(week).all()
    ).results;
    const { params, saved } = await getParams(env, week);
    return json({ week_start: week, exists: Boolean(plan), created_at: plan?.created_at ?? null, params, params_saved: saved, items });
  }

  if ((path === '/api/shopping' || path === '/api/prep' || path === '/api/bundle') && method === 'GET') {
    const week = url.searchParams.get('week');
    if (!validWeek(week)) return fail(400, 'Ungültige Woche.');
    const { items, recipes } = await loadWeek(env, week);
    const { prep, shopping } = assembleWeek(items, recipes, rules);
    if (path === '/api/shopping') return json(shopping);
    if (path === '/api/prep') return json(prep);
    const view = (await env.DB.prepare(`${ITEM_SELECT} WHERE i.week_start = ? ORDER BY i.day, i.id`).bind(week).all()).results;
    return json({ week_start: week, items: view, prep, shopping });
  }

  if (path === '/api/firma/ensure' && method === 'POST') {
    const b = await readBody(request);
    if (!validWeek(b.week_start)) return fail(400, 'Ungültige Woche.');
    return json(await ensureFirma(env, b.week_start));
  }

  let m;
  if ((m = path.match(/^\/api\/items\/(\d+)\/candidates$/)) && method === 'GET') {
    const item = await loadItem(env, Number(m[1]));
    if (!item) return fail(404, 'Eintrag nicht gefunden.');
    return json({ candidates: (await candidatesFor(env, item, 12)).map(candidateView) });
  }

  if ((m = path.match(/^\/api\/items\/(\d+)\/swap$/)) && method === 'POST') {
    const item = await loadItem(env, Number(m[1]));
    if (!item) return fail(404, 'Eintrag nicht gefunden.');
    const cands = (await candidatesFor(env, item, 5)).filter((r) => r.id !== item.recipe_id);
    if (!cands.length) return fail(409, 'Keine passende Alternative gefunden.');
    const pick = cands[Math.floor(Math.random() * cands.length)];
    await env.DB.prepare("UPDATE plan_items SET kind = 'recipe', recipe_id = ?, title = NULL, leftover = 0, note = NULL WHERE id = ?").bind(pick.id, item.id).run();
    return json({ item: await itemView(env, item.id) });
  }

  if ((m = path.match(/^\/api\/items\/(\d+)$/))) {
    const id = Number(m[1]);
    const item = await loadItem(env, id);
    if (!item) return fail(404, 'Eintrag nicht gefunden.');

    if (method === 'PUT') {
      const b = await readBody(request);
      const next = { ...item };
      if (b.recipe_id !== undefined && b.recipe_id !== null) {
        const r = await env.DB.prepare('SELECT id FROM recipes WHERE id = ? AND blocked = 0').bind(Number(b.recipe_id)).first();
        if (!r) return fail(400, 'Rezept nicht gefunden oder gesperrt.');
        next.kind = 'recipe';
        next.recipe_id = r.id;
        next.title = null;
        next.leftover = 0;
      } else if (b.kind === 'custom' && typeof b.title === 'string' && b.title.trim()) {
        next.kind = 'custom';
        next.recipe_id = null;
        next.title = b.title.trim().slice(0, 120);
        next.leftover = 0;
      } else if (b.kind === 'placeholder') {
        next.kind = 'placeholder';
        next.recipe_id = null;
        next.title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 60) : 'HelloFresh';
        next.leftover = 0;
      } else if (b.kind === 'skip') {
        next.kind = 'skip';
        next.recipe_id = null;
        next.title = null;
        next.leftover = 0;
      }
      if (b.servings !== undefined) next.servings = Math.min(12, Math.max(1, Math.round(Number(b.servings)) || 1));
      if (b.note !== undefined) next.note = b.note ? String(b.note).slice(0, 200) : null;
      await env.DB.prepare('UPDATE plan_items SET kind = ?, recipe_id = ?, title = ?, servings = ?, note = ?, leftover = ? WHERE id = ?')
        .bind(next.kind, next.recipe_id, next.title, next.servings, next.note, next.leftover, id).run();
      return json({ item: await itemView(env, id) });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM plan_items WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/plan/items' && method === 'POST') {
    const b = await readBody(request);
    if (!validWeek(b.week_start)) return fail(400, 'Ungültige Woche.');
    if (!Number.isInteger(b.day) || b.day < 0 || b.day > 6) return fail(400, 'Ungültiger Tag.');
    if (!SLOTS.includes(b.slot)) return fail(400, 'Ungültige Mahlzeit.');
    await env.DB.prepare('INSERT OR IGNORE INTO plans (week_start, created_at, seed, params) VALUES (?,?,0,?)')
      .bind(b.week_start, new Date().toISOString(), '{}').run();
    let kind = 'custom';
    let recipeId = null;
    let title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
    if (b.recipe_id) {
      const r = await env.DB.prepare('SELECT id FROM recipes WHERE id = ? AND blocked = 0').bind(Number(b.recipe_id)).first();
      if (!r) return fail(400, 'Rezept nicht gefunden oder gesperrt.');
      kind = 'recipe';
      recipeId = r.id;
      title = null;
    } else if (!title) {
      return fail(400, 'Titel oder Rezept angeben.');
    }
    const res = await env.DB.prepare('INSERT INTO plan_items (week_start, day, slot, kind, recipe_id, title, servings, note, leftover) VALUES (?,?,?,?,?,?,?,?,0)')
      .bind(b.week_start, b.day, b.slot, kind, recipeId, title, Math.min(12, Math.max(1, Math.round(Number(b.servings)) || 1)), null).run();
    return json({ item: await itemView(env, res.meta.last_row_id) });
  }

  if ((m = path.match(/^\/api\/recipes\/(\d+)\/rate$/)) && method === 'POST') {
    const b = await readBody(request);
    const rating = [-1, 0, 1].includes(b.rating) ? b.rating : 0;
    await env.DB.prepare('UPDATE recipes SET rating = ? WHERE id = ?').bind(rating, Number(m[1])).run();
    return json({ ok: true, rating });
  }

  if (path === '/api/recipes/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const slot = url.searchParams.get('slot');
    if (q.length < 2) return json({ results: [] });
    const conds = ['blocked = 0', 'rating >= 0', 'title LIKE ?'];
    if (SLOTS.includes(slot)) conds.push(`s_${slot} = 1`);
    const rows = (
      await env.DB.prepare(`SELECT ${RECIPE_COLS} FROM recipes WHERE ${conds.join(' AND ')} LIMIT 20`).bind(`%${q.replace(/[%_]/g, '')}%`).all()
    ).results;
    return json({ results: rows.map(candidateView) });
  }

  if (path === '/api/params' && method === 'GET') {
    const week = url.searchParams.get('week');
    if (!validWeek(week)) return fail(400, 'Ungültige Woche.');
    const { defaults, params, saved } = await getParams(env, week);
    return json({ defaults, params, saved });
  }
  if (path === '/api/params' && method === 'PUT') {
    const b = await readBody(request);
    if (!validWeek(b.week_start)) return fail(400, 'Ungültige Woche.');
    const { defaults } = await getParams(env, b.week_start);
    const params = normalizeParams(b.params, defaults);
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(`params:${b.week_start}`, JSON.stringify(params)).run();
    await env.DB.prepare('UPDATE plans SET params = ? WHERE week_start = ?').bind(JSON.stringify(params), b.week_start).run();
    const firma = await ensureFirma(env, b.week_start);
    return json({ params, firma });
  }
  if (path === '/api/defaults' && method === 'PUT') {
    const b = await readBody(request);
    const params = normalizeParams(b.params, normalizeParams(null, rules.defaults));
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('defaults', JSON.stringify(params)).run();
    return json({ defaults: params });
  }

  if (path === '/api/regenerate' && method === 'POST') {
    const b = await readBody(request);
    if (!validWeek(b.week_start)) return fail(400, 'Ungültige Woche.');
    if (!env.GH_TOKEN || !env.GH_REPO) {
      return json({ error: 'Neu-Erzeugen per Knopf ist nicht eingerichtet (GH_TOKEN/GH_REPO fehlen). In GitHub unter Actions → „Wochenplan“ → „Run workflow“ starten.', configured: false }, 501);
    }
    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/weekly.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'essensplan-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: env.GH_BRANCH || 'main', inputs: { step: 'plan', week: b.week_start, force: 'true' } }),
    });
    if (res.status !== 204) return fail(502, `GitHub antwortete mit ${res.status}.`);
    return json({ ok: true });
  }

  return fail(404, 'Unbekannte Route.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (e) {
      console.error(e);
      return fail(500, 'Interner Fehler.');
    }
  },
};

export { SLOT_ORDER };
