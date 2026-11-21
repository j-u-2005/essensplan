// Rendert Plan + Vorbereitung + Einkaufsliste als PDF (headless Chrome) und verschickt es per Resend.
// Aufruf: node scripts/send-plan.mjs   (Env: CF_ACCOUNT_ID, CF_API_TOKEN, D1_DATABASE_ID, optional WEEK,
// RESEND_API_KEY, MAIL_TO, MAIL_FROM, SEND_ALWAYS=1)
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { d1 as query } from './d1.mjs';
import { assembleWeek } from '../src/lib/weekdata.js';
import { renderPrintHtml } from '../public/printview.js';
import { planningWeek } from '../src/lib/dates.js';

const rules = JSON.parse(await readFile(new URL('../config/rules.json', import.meta.url), 'utf8'));
const flagWeek = await readFile('plan-created.flag', 'utf8').then((t) => t.trim(), () => '');
const week = process.env.WEEK || flagWeek || planningWeek();
const exists = async (p) => access(p).then(() => true, () => false);

if (!process.env.SEND_ALWAYS && !process.env.WEEK && !(await exists('plan-created.flag'))) {
  console.log('Kein neuer Plan in diesem Lauf – kein PDF/Mail (SEND_ALWAYS=1 erzwingt es).');
  process.exit(0);
}

const items = await query(
  `SELECT i.id, i.week_start, i.day, i.slot, i.kind, i.recipe_id, i.title, i.servings, i.note, i.leftover,
          r.title AS recipe_title, r.url, r.minutes
     FROM plan_items i LEFT JOIN recipes r ON r.id = i.recipe_id WHERE i.week_start = ? ORDER BY i.day, i.id`,
  [week],
);
if (!items.length) {
  console.log(`Für ${week} gibt es keinen Plan.`);
  process.exit(0);
}
const recipes = await query(
  `SELECT id, title, url, effort, shelf_days, servings, ingredients FROM recipes
    WHERE id IN (SELECT recipe_id FROM plan_items WHERE week_start = ? AND recipe_id IS NOT NULL)`,
  [week],
);
const { prep, shopping } = assembleWeek(items, recipes, rules);
const html = renderPrintHtml({ week, items, shopping, prep });

await mkdir('out', { recursive: true });
const htmlPath = `${process.cwd()}/out/essensplan-${week}.html`;
const pdfPath = `${process.cwd()}/out/essensplan-${week}.pdf`;
await writeFile(htmlPath, html);

const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((b) => spawnSync('which', [b]).status === 0);
if (!chrome) throw new Error('Kein Chrome/Chromium gefunden.');
const r = spawnSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`], { encoding: 'utf8' });
if (r.status !== 0 || !(await exists(pdfPath))) throw new Error(`PDF-Erzeugung fehlgeschlagen: ${r.stderr}`);
console.log(`PDF erstellt: ${pdfPath}`);

const key = process.env.RESEND_API_KEY;
const to = process.env.MAIL_TO;
if (!key || !to) {
  console.log('RESEND_API_KEY/MAIL_TO nicht gesetzt – kein Mailversand (PDF liegt als Artefakt im Lauf).');
  process.exit(0);
}
const kwNum = (() => {
  const d = new Date(`${week}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round(((d - j) / 86400000 - 3 + ((j.getUTCDay() + 6) % 7)) / 7);
})();
const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: process.env.MAIL_FROM || 'Essensplan <onboarding@resend.dev>',
    to: to.split(',').map((s) => s.trim()),
    subject: `Essensplan KW ${kwNum}`,
    html: `<p>Hallo, der Essensplan für KW ${kwNum} ist da: Wochenplan, Vorbereitung (Sonntag und Mittwochabend) und Einkaufsliste im Anhang.</p>`,
    attachments: [{ filename: `essensplan-kw${kwNum}.pdf`, content: (await readFile(pdfPath)).toString('base64') }],
  }),
});
if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
console.log('Mail verschickt an', to);
