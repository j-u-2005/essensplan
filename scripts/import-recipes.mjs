/**
 * Rezept-Import: liest Sitemaps der konfigurierten Seiten, lädt einzelne Rezeptseiten
 * (höflich, mit Pause, robots.txt-konform) und speichert nur strukturierte Daten + Quelllink.
 *
 * Umgebungsvariablen:
 *   IMPORT_LIMIT        neue Seiten pro Quelle und Lauf (Standard 100)
 *   IMPORT_DELAY_MS     Pause zwischen Abrufen derselben Seite (Standard 3000)
 *   IMPORT_MAX_MINUTES  Gesamtlaufzeit-Limit (Standard 45)
 *   ONLY                Komma-Liste von Quell-IDs
 *   REBLOCK=1           statt Import: Sperrliste auf alle gespeicherten Rezepte neu anwenden
 *   DRY_RUN=1           nichts in die Datenbank schreiben
 *   SOURCES_FILE        alternative Quellen-Konfiguration (für Tests)
 */
import { readFile, appendFile, access } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { d1, d1Batch, d1Configured } from './d1.mjs';
import { parseRobots, isAllowed, crawlDelay } from '../src/lib/robots.js';
import { parseSitemapXml } from '../src/lib/sitemap.js';
import { extractJsonLd, findRecipes, normalizeRecipe } from '../src/lib/jsonld.js';
import { parseIngredient } from '../src/lib/ingredients.js';
import { classifyRecipe, rawContext } from '../src/lib/classify.js';
import { compileBlocklist, checkRecipe } from '../src/lib/blocklist.js';

const readJson = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LIMIT = Number(process.env.IMPORT_LIMIT) || 100;
const DELAY = Number(process.env.IMPORT_DELAY_MS ?? 3000);
const MAX_MS = (Number(process.env.IMPORT_MAX_MINUTES) || 45) * 60000;
const DRY = process.env.DRY_RUN === '1';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const started = Date.now();

const sourcesConfig = process.env.SOURCES_FILE
  ? JSON.parse(await readFile(process.env.SOURCES_FILE, 'utf8'))
  : await readJson('../config/sources.json');
const blocklist = compileBlocklist(await readJson('../config/blocklist.json'));
const repo = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : sourcesConfig.userAgentContact;
const UA = `EssensplanBot/1.0 (+${repo}; privater Gebrauch, 1 Anfrage je ${Math.round(DELAY / 1000)} s)`;

const summary = [];

async function fetchBytes(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9', Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url) {
  let buf = await fetchBytes(url);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return buf.toString('utf8');
}

async function collectUrls(source, robots) {
  const queue = source.sitemaps?.length ? [...source.sitemaps] : [...robots.sitemaps];
  const seen = new Set();
  const urls = [];
  let fetched = 0;
  while (queue.length && fetched < 60) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    try {
      await sleep(Math.min(DELAY, 1500));
      const xml = await fetchText(sm);
      fetched++;
      const parsed = parseSitemapXml(xml);
      queue.push(...parsed.sitemaps);
      urls.push(...parsed.urls);
    } catch (e) {
      console.warn(`  Sitemap ${sm}: ${e.message}`);
    }
  }
  return urls;
}

async function knownUrls(sourceId) {
  const known = new Set();
  if (!d1Configured()) return known;
  for (let offset = 0; ; offset += 5000) {
    const rows = await d1('SELECT url FROM crawl WHERE source = ? LIMIT 5000 OFFSET ?', [sourceId, offset]);
    rows.forEach((r) => known.add(r.url));
    if (rows.length < 5000) break;
  }
  return known;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function recipeStatements(source, url, rec) {
  const ctxRaw = rawContext(rec.title, rec.categories);
  const verdict = checkRecipe({ title: rec.title, ingredients: rec.ingredients, rawContext: ctxRaw }, blocklist);
  const cls = classifyRecipe(rec);
  const parsed = rec.ingredients.map(parseIngredient);
  const now = new Date().toISOString();
  return {
    blocked: verdict.blocked,
    statements: [
      {
        sql: `INSERT OR IGNORE INTO recipes (url, source, title, image, servings, minutes, effort, ingredients,
          s_breakfast, s_lunch, s_snack, s_dinner, cold_ok, micro_ok, shelf_days, batch_ok, sweet, oats, fructose,
          cost, protein, dtype, leftover_ok, s_firma, raw_ctx, blocked, blocked_reason, imported_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        params: [
          url, source.id, rec.title, rec.image, rec.servings ?? 4, cls.minutes, cls.effort, JSON.stringify(parsed),
          cls.s_breakfast, cls.s_lunch, cls.s_snack, cls.s_dinner, cls.cold_ok, cls.micro_ok, cls.shelf_days, cls.batch_ok,
          cls.sweet, cls.oats, cls.fructose, cls.cost, cls.protein, cls.dtype, cls.leftover_ok, cls.s_firma, ctxRaw ? 1 : 0,
          verdict.blocked ? 1 : 0, verdict.blocked ? verdict.reasons.join(', ') : null, now,
        ],
      },
      { sql: 'INSERT OR REPLACE INTO crawl (url, source, status, fetched_at) VALUES (?,?,?,?)', params: [url, source.id, verdict.blocked ? 'blocked' : 'ok', now] },
    ],
  };
}

async function importSource(source) {
  const stats = { id: source.id, name: source.name, urls: 0, pattern: 0, fetched: 0, recipes: 0, blocked: 0, nojson: 0, errors: 0, note: '' };
  summary.push(stats);
  console.log(`\n== ${source.name} ==`);

  let robots;
  try {
    robots = parseRobots(await fetchText(source.robots));
  } catch (e) {
    if (e.status === 404) robots = parseRobots('');
    else {
      stats.note = `robots.txt nicht lesbar (${e.message}) – Quelle übersprungen`;
      console.warn('  ' + stats.note);
      return;
    }
  }
  const delay = Math.max(DELAY, (crawlDelay(robots, UA) ?? 0) * 1000);

  const all = await collectUrls(source, robots);
  stats.urls = all.length;
  const re = source.urlPattern ? new RegExp(source.urlPattern, 'iu') : null;
  let candidates = re ? all.filter((u) => re.test(u)) : all;
  stats.pattern = candidates.length;
  if (re && candidates.length === 0 && all.length > 0) {
    stats.note = 'urlPattern ohne Treffer – nutze alle Sitemap-URLs (Muster in config/sources.json prüfen)';
    console.warn('  ' + stats.note);
    candidates = all;
  }
  candidates = candidates.filter((u) => {
    try {
      const p = new URL(u);
      return isAllowed(robots, p.pathname + p.search, UA);
    } catch {
      return false;
    }
  });

  const known = DRY ? new Set() : await knownUrls(source.id);
  const fresh = shuffle(candidates.filter((u) => !known.has(u))).slice(0, LIMIT);
  console.log(`  ${all.length} URLs, ${candidates.length} passend, ${fresh.length} neu in diesem Lauf`);

  let buffer = [];
  const flush = async () => {
    if (!buffer.length || DRY) {
      buffer = [];
      return;
    }
    await d1Batch(buffer);
    buffer = [];
  };

  let consecutiveErrors = 0;
  for (const url of fresh) {
    if (Date.now() - started > MAX_MS) {
      stats.note = (stats.note ? stats.note + '; ' : '') + 'Zeitlimit erreicht';
      break;
    }
    await sleep(delay);
    let html;
    try {
      html = await fetchText(url);
      consecutiveErrors = 0;
    } catch (e) {
      stats.errors++;
      consecutiveErrors++;
      console.warn(`  ${url}: ${e.message}`);
      if (e.status === 404 || e.status === 410) buffer.push({ sql: 'INSERT OR REPLACE INTO crawl (url, source, status, fetched_at) VALUES (?,?,?,?)', params: [url, source.id, 'gone', new Date().toISOString()] });
      if (consecutiveErrors >= 5) {
        stats.note = (stats.note ? stats.note + '; ' : '') + 'Abbruch nach 5 Fehlern in Folge';
        break;
      }
      continue;
    }
    stats.fetched++;
    const rec = findRecipes(extractJsonLd(html)).map(normalizeRecipe).find(Boolean);
    if (!rec) {
      stats.nojson++;
      buffer.push({ sql: 'INSERT OR REPLACE INTO crawl (url, source, status, fetched_at) VALUES (?,?,?,?)', params: [url, source.id, 'nojson', new Date().toISOString()] });
    } else {
      const { blocked, statements } = recipeStatements(source, url, rec);
      buffer.push(...statements);
      stats.recipes++;
      if (blocked) stats.blocked++;
    }
    if (buffer.length >= 20) await flush();
  }
  await flush();
  console.log(`  Ergebnis: ${stats.recipes} Rezepte (${stats.blocked} gesperrt), ${stats.nojson} ohne JSON-LD, ${stats.errors} Fehler`);
}

async function loadCurated() {
  // Von Hand geprüfte Zuordnung: { recipes: { "<url>": "B" | "L" | "D" | "F" kombinierbar | "X" } }
  const file = new URL('../config/curated.json', import.meta.url);
  try {
    await access(file);
  } catch {
    return {};
  }
  return JSON.parse(await readFile(file, 'utf8')).recipes || {};
}

async function reblock() {
  const curated = await loadCurated();
  console.log(`Geprüfte Rezepte in config/curated.json: ${Object.keys(curated).length}`);
  let offset = 0;
  let changed = 0;
  let slotChanges = 0;
  for (;;) {
    const rows = await d1('SELECT id, url, title, minutes, ingredients, raw_ctx, blocked, blocked_reason, s_lunch, s_dinner, s_snack, s_breakfast, s_firma FROM recipes ORDER BY id LIMIT 500 OFFSET ?', [offset]);
    if (!rows.length) break;
    const updates = [];
    for (const r of rows) {
      const lines = JSON.parse(r.ingredients).map((i) => [i.a, i.u, i.n].filter((x) => x !== null && x !== undefined).join(' '));
      const verdict = checkRecipe({ title: r.title, ingredients: lines, rawContext: Boolean(r.raw_ctx) }, blocklist);
      const reason = verdict.blocked ? verdict.reasons.join(', ') : null;
      if (Boolean(r.blocked) !== verdict.blocked || (r.blocked_reason ?? null) !== reason) {
        updates.push({ sql: 'UPDATE recipes SET blocked = ?, blocked_reason = ? WHERE id = ?', params: [verdict.blocked ? 1 : 0, reason, r.id] });
      }
      // Mahlzeiten-Zuordnung nur verschärfen (Getränke, Dips, Saucen raus), nie erweitern
      const c = classifyRecipe({ title: r.title, ingredients: lines, minutes: r.minutes });
      const next = {
        s_breakfast: r.s_breakfast && c.s_breakfast ? 1 : 0,
        s_lunch: r.s_lunch && c.s_lunch ? 1 : 0,
        s_dinner: r.s_dinner && c.s_dinner ? 1 : 0,
        s_snack: r.s_snack && c.s_snack ? 1 : 0,
        s_firma: r.s_firma && c.s_firma ? 1 : 0,
      };
      const code = curated[r.url];
      if (code) {
        // Handprüfung hat Vorrang vor den Regeln
        next.s_breakfast = code.includes('B') ? 1 : 0;
        next.s_lunch = code.includes('L') ? 1 : 0;
        next.s_dinner = code.includes('D') ? 1 : 0;
        next.s_firma = code.includes('F') ? 1 : 0;
      }
      const rowChanged = Object.keys(next).some((k) => next[k] !== r[k]);
      if (rowChanged) {
        updates.push({
          sql: 'UPDATE recipes SET s_breakfast = ?, s_lunch = ?, s_dinner = ?, s_snack = ?, s_firma = ? WHERE id = ?',
          params: [next.s_breakfast, next.s_lunch, next.s_dinner, next.s_snack, next.s_firma, r.id],
        });
        slotChanges++;
      }
    }
    changed += updates.length;
    if (updates.length && !DRY) await d1Batch(updates);
    offset += rows.length;
  }
  console.log(`Sperrliste neu angewendet: ${changed} Änderungen, davon ${slotChanges} Mahlzeiten-Zuordnungen verschärft.`);
}

if (process.env.REBLOCK === '1') {
  await reblock();
} else {
  if (!DRY && !d1Configured()) {
    console.error('CF_ACCOUNT_ID, CF_API_TOKEN und D1_DATABASE_ID fehlen (oder DRY_RUN=1 setzen).');
    process.exit(1);
  }
  for (const source of sourcesConfig.sources) {
    if (ONLY.length && !ONLY.includes(source.id)) continue;
    try {
      await importSource(source);
    } catch (e) {
      console.error(`Quelle ${source.id} fehlgeschlagen: ${e.message}`);
      summary.push({ id: source.id, name: source.name, note: `Fehler: ${e.message}` });
    }
  }
  if (!DRY && d1Configured()) {
    const [row] = await d1('SELECT COUNT(*) AS total, SUM(blocked = 0) AS usable FROM recipes');
    console.log(`\nDatenbank: ${row.total} Rezepte, davon ${row.usable ?? 0} nutzbar.`);
    summary.push({ id: 'db', name: 'Datenbank gesamt', note: `${row.total} Rezepte, ${row.usable ?? 0} nutzbar` });
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ['### Rezept-Import', '', '| Quelle | URLs | passend | abgerufen | Rezepte | gesperrt | ohne JSON-LD | Fehler | Hinweis |', '|---|---|---|---|---|---|---|---|---|'];
  for (const s of summary) lines.push(`| ${s.name} | ${s.urls ?? ''} | ${s.pattern ?? ''} | ${s.fetched ?? ''} | ${s.recipes ?? ''} | ${s.blocked ?? ''} | ${s.nojson ?? ''} | ${s.errors ?? ''} | ${s.note ?? ''} |`);
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
