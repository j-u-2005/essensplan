// Gemeinsame Druckvorlage: wird im Browser (PDF-Knopf) und in Node (GitHub Actions, Mailversand) verwendet.
// Reine String-Funktionen, kein DOM, keine Emojis (damit der Headless-Chrome sie überall sauber setzt).

const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const SLOTS = {
  breakfast: 'Frühstück',
  lunch: 'Mittag',
  firma: 'Firma (Papa)',
  snack: 'Snack',
  dinner: 'Abend',
};
const SLOT_CLASS = { breakfast: 'b', lunch: 'l', firma: 'f', snack: 's', dinner: 'd' };
const SLOT_ORDER = ['breakfast', 'lunch', 'firma', 'snack', 'dinner'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pad = (n) => String(n).padStart(2, '0');
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
const shortDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
function isoWeek(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round(((dt - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

function itemTitle(i) {
  if (i.kind === 'recipe') return i.recipe_title || i.title || '(Rezept fehlt)';
  if (i.kind === 'placeholder') return i.title || 'HelloFresh';
  if (i.kind === 'skip') return 'Entfällt';
  return i.title || '-';
}

function usesText(uses) {
  return uses.map((u) => `${DAY_SHORT[u.day]} ${SLOTS[u.slot] || u.slot}`).join(', ');
}

function planPage(week, items) {
  const byDay = Array.from({ length: 7 }, () => []);
  for (const i of items) byDay[i.day].push(i);
  const rows = byDay
    .map((list, d) => {
      list.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
      const cells = list
        .filter((i) => i.kind !== 'skip')
        .map((i) => {
          const meta = [];
          if (i.kind === 'recipe') {
            meta.push(`${i.servings} Port.`);
            if (i.minutes) meta.push(`${i.minutes} min`);
            if (i.leftover) meta.push('Reste');
          }
          if (i.note) meta.push(i.note);
          return `<div class="it ${SLOT_CLASS[i.slot]}"><span class="sl">${esc(SLOTS[i.slot])}</span><span class="tt">${esc(itemTitle(i))}</span>${meta.length ? `<span class="mt">${esc(meta.join(' · '))}</span>` : ''}</div>`;
        })
        .join('');
      return `<section class="day"><h3>${DAYS[d]}<small>${shortDate(addDays(week, d))}</small></h3>${cells || '<div class="it none">Nichts geplant</div>'}</section>`;
    })
    .join('');
  return `<div class="page"><header><h1>Essensplan</h1><p>KW ${isoWeek(week)} · ${shortDate(week)} – ${shortDate(addDays(week, 6))}</p></header><div class="days">${rows}</div></div>`;
}

function taskHtml(t) {
  return `<li><span class="box"></span><div><b>${esc(t.title)}</b><span class="mt">${t.minutes} min · ${t.portions} Port.${t.tight ? ' · knapp haltbar' : ''}</span><span class="for">für ${esc(usesText(t.uses))}</span></div></li>`;
}

function prepPage(prep) {
  const sessions = prep.sessions
    .map((s) => {
      const total = s.tasks.reduce((a, t) => a + t.minutes, 0);
      return `<section class="sess"><h3>${esc(s.label)}<small>ca. ${total} min</small></h3><ul>${s.tasks.map(taskHtml).join('')}</ul></section>`;
    })
    .join('');
  const fresh = prep.fresh.length
    ? `<section class="sess alt"><h3>Frisch kurz vorher<small>kaum haltbar</small></h3><ul>${prep.fresh
        .map((t) => `<li><span class="box"></span><div><b>${esc(t.title)}</b><span class="mt">${t.minutes} min</span><span class="for">für ${esc(usesText(t.uses))}</span></div></li>`)
        .join('')}</ul></section>`
    : '';
  const dinners = prep.dinners.length
    ? `<section class="sess alt"><h3>Abendessen<small>wird frisch gekocht</small></h3><ul>${prep.dinners
        .map((d) => `<li><span class="box"></span><div><b>${esc(d.title)}</b><span class="mt">${DAYS[d.day]} · ${d.minutes} min · ${d.servings} Pers.</span></div></li>`)
        .join('')}</ul></section>`
    : '';
  const warn = prep.warnings.length ? `<div class="warn">${prep.warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : '';
  return `<div class="page"><header><h1>Vorbereitung</h1><p>Wann was gekocht wird</p></header>${sessions || '<p>Nichts vorzubereiten.</p>'}${fresh}${dinners}${warn}</div>`;
}

function shopPage(shopping) {
  const line = (it) => `<li><span class="box"></span><span class="n">${esc(it.text)}</span>${it.when && it.when.length ? `<span class="wh">${esc(it.when.join(' · '))}</span>` : ''}</li>`;
  const groups = shopping.groups
    .map((g) => `<section class="cat"><h3>${esc(g.category)}</h3><ul>${g.items.map(line).join('')}</ul></section>`)
    .join('');
  const pantry = shopping.pantry.length
    ? `<section class="cat pantry"><h3>Vorrat <small>vermutlich vorhanden</small></h3><ul>${shopping.pantry.map(line).join('')}</ul></section>`
    : '';
  return `<div class="page"><header><h1>Einkaufsliste</h1><p>Rechts steht, wann die Zutat gebraucht wird</p></header><div class="cats">${groups}${pantry}</div></div>`;
}

export const PRINT_CSS = `
@page { size: A4; margin: 12mm 12mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; color: #2b2a3a; font: 10pt/1.35 "Helvetica Neue", Arial, "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
header { border-radius: 14px; padding: 12px 16px; margin-bottom: 12px; background: linear-gradient(120deg, #e4e0fb, #fde4dc); }
header h1 { margin: 0; font-size: 20pt; letter-spacing: .01em; color: #3b3866; }
header p { margin: 2px 0 0; color: #6d6a8c; font-size: 10pt; }
.days { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.day { border: 1px solid #e6e3f2; border-radius: 12px; padding: 7px 9px 8px; background: #fff; break-inside: avoid; }
.day:nth-child(7) { grid-column: 1 / -1; }
.day h3 { margin: 0 0 5px; font-size: 10.5pt; color: #3b3866; display: flex; justify-content: space-between; }
.day h3 small { font-weight: 400; color: #8a87a8; }
.it { border-radius: 8px; padding: 4px 7px; margin-top: 3px; display: grid; grid-template-columns: 72px 1fr; column-gap: 6px; align-items: baseline; }
.it .sl { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #5c5a7a; }
.it .tt { font-weight: 600; }
.it .mt { grid-column: 2; font-size: 8pt; color: #6d6a8c; }
.it.b { background: #fff0e8; } .it.l { background: #eaf5ea; } .it.f { background: #fff6d6; } .it.s { background: #fdebf3; } .it.d { background: #ece9fb; } .it.none { background: #f6f5fa; color: #8a87a8; display: block; }
.sess, .cat { border: 1px solid #e6e3f2; border-radius: 12px; padding: 8px 12px 6px; margin-bottom: 9px; break-inside: avoid; background: #fff; }
.sess h3, .cat h3 { margin: 0 0 4px; font-size: 11pt; color: #3b3866; display: flex; justify-content: space-between; }
.sess h3 small, .cat h3 small { font-weight: 400; color: #8a87a8; font-size: 8.5pt; }
.sess { background: #f4f2ff; }
.sess.alt { background: #fff7ef; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; gap: 8px; align-items: flex-start; padding: 3px 0; border-top: 1px solid #ecebf5; }
li:first-child { border-top: 0; }
.box { flex: none; width: 10px; height: 10px; border: 1.4px solid #9a97c0; border-radius: 3px; margin-top: 3px; }
li b { display: block; }
li .mt, li .for { display: block; font-size: 8.5pt; color: #6d6a8c; }
li .for { color: #4a4778; }
.cats { columns: 2; column-gap: 9px; }
.cat { display: block; }
.cat li { align-items: baseline; }
.cat .n { flex: 1; }
.cat .wh { font-size: 8pt; color: #6d6a8c; text-align: right; max-width: 48%; }
.cat.pantry { background: #f7f6fb; }
.warn { margin-top: 8px; border-radius: 10px; padding: 6px 10px; background: #fff0e8; color: #8a4a2a; font-size: 9pt; }
.warn p { margin: 2px 0; }
`;

/** Liefert ein komplettes HTML-Dokument (A4, drei Seiten: Plan, Vorbereitung, Einkauf). */
export function renderPrintHtml({ week, items, shopping, prep }) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Essensplan KW ${isoWeek(week)}</title><style>${PRINT_CSS}</style></head><body>${planPage(week, items)}${prepPage(prep)}${shopPage(shopping)}</body></html>`;
}
