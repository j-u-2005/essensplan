const DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const SLOT = {
  breakfast: { ico: '🥣', label: 'Frühstück' },
  lunch: { ico: '🍱', label: 'Mittag' },
  firma: { ico: '🏢', label: 'Firma (Papa)' },
  snack: { ico: '🍎', label: 'Snack' },
  dinner: { ico: '🍽️', label: 'Abend' },
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = { week: null, view: 'plan', plan: null, shopping: null, currentWeek: null, weeks: [] };

// ---------- Datum ----------
const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const short = (s) => { const [, m, d] = s.split('-'); return `${d}.${m}.`; };
function kw(s) {
  const d = parse(s);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4, 12));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}
const berlinToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date());

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && path !== '/api/login') {
    renderLogin();
    throw new Error('Nicht angemeldet');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
const fail = (e) => toast(e.message || 'Fehler');

// ---------- Login ----------
function renderLogin() {
  $('#app').innerHTML = `
    <form class="login" id="loginForm">
      <h1>🍽️ Essensplan</h1>
      <input type="password" id="pw" placeholder="Passwort" autocomplete="current-password" required autofocus>
      <div class="error" id="loginErr"></div>
      <button class="primary" type="submit">Anmelden</button>
    </form>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { password: $('#pw').value } });
      await boot();
    } catch (err) {
      $('#loginErr').textContent = err.message;
    }
  });
}

// ---------- Rahmen ----------
function shell() {
  const w = state.week;
  $('#app').innerHTML = `
    <header class="topbar">
      <div class="weeknav">
        <button class="iconbtn" id="prev" aria-label="Vorherige Woche">‹</button>
        <h1>KW ${kw(w)}<small>${short(w)} – ${short(addDays(w, 6))}${w === state.currentWeek ? ' · aktuelle Planung' : ''}</small></h1>
        <button class="iconbtn" id="next" aria-label="Nächste Woche">›</button>
      </div>
      <nav class="tabs" role="tablist">
        ${[['plan', 'Plan'], ['prep', 'Vorbereitung'], ['shop', 'Einkauf'], ['week', 'Woche']]
          .map(([id, l]) => `<button role="tab" data-view="${id}" aria-selected="${state.view === id}">${l}</button>`).join('')}
      </nav>
    </header>
    <main id="main"></main>`;
  $('#prev').onclick = () => go(addDays(state.week, -7));
  $('#next').onclick = () => go(addDays(state.week, 7));
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { state.view = b.dataset.view; render(); }));
}

async function go(week) {
  state.week = week;
  state.plan = null;
  state.shopping = null;
  await render();
}

async function render() {
  shell();
  const main = $('#main');
  main.innerHTML = '<p class="empty">Lade …</p>';
  try {
    if (state.view === 'plan') await renderPlan(main);
    else if (state.view === 'prep') await renderPrep(main);
    else if (state.view === 'shop') await renderShop(main);
    else await renderWeek(main);
  } catch (e) {
    if (e.message !== 'Nicht angemeldet') main.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

// ---------- Plan ----------
async function loadPlan() {
  state.plan = await api(`/api/plan?week=${state.week}`);
  return state.plan;
}

function itemTitle(i) {
  if (i.kind === 'recipe') return i.recipe_title || '(Rezept fehlt)';
  if (i.kind === 'placeholder') return i.title || 'HelloFresh';
  if (i.kind === 'skip') return 'Entfällt';
  return i.title || '—';
}

function rowHtml(i) {
  const s = SLOT[i.slot];
  const missing = i.kind === 'custom' && /^Noch kein Rezept/.test(i.title || '');
  const meta = [];
  if (i.kind === 'recipe') {
    if (i.minutes) meta.push(`${i.minutes} min`);
    meta.push(`${i.servings} Port.`);
    if (i.leftover) meta.push('Reste');
    if (i.source) meta.push(i.source);
  } else if (i.kind === 'custom' && !missing) {
    meta.push(`${i.servings} Port.`);
  }
  if (i.note) meta.push(i.note);
  const title = i.kind === 'recipe' && i.url
    ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(itemTitle(i))}</a>`
    : esc(itemTitle(i));
  const swap = i.kind !== 'placeholder' && i.kind !== 'skip' ? `<button data-act="swap" data-id="${i.id}" title="Zufällig tauschen" aria-label="Tauschen">🔄</button>` : '';
  return `<div class="row s-${i.slot} ${i.kind}${missing ? ' missing' : ''}" data-id="${i.id}">
    <div class="ico" title="${s.label}">${s.ico}</div>
    <div><div class="t">${title}</div><div class="m">${esc(meta.join(' · '))}</div></div>
    <div class="btns">${swap}<button data-act="edit" data-id="${i.id}" title="Bearbeiten" aria-label="Bearbeiten">✏️</button><button data-act="del" data-id="${i.id}" title="Löschen" aria-label="Löschen">🗑️</button></div>
  </div>`;
}

async function renderPlan(main) {
  const plan = await loadPlan();
  if (!plan.items.length) {
    main.innerHTML = `<div class="empty">
      <p>Für diese Woche gibt es noch keinen Plan.</p>
      <p><button class="primary" id="regen">Plan jetzt erzeugen</button></p>
      <p class="hint">Der Plan entsteht automatisch jeden Freitag. Hier kannst du ihn vorher auslösen.</p></div>`;
    $('#regen').onclick = regenerate;
    return;
  }
  const today = berlinToday();
  const byDay = Array.from({ length: 7 }, () => []);
  plan.items.forEach((i) => byDay[i.day].push(i));
  main.innerHTML = byDay
    .map((items, d) => {
      const date = addDays(state.week, d);
      return `<section class="day${date === today ? ' today' : ''}">
        <h2>${DAYS[d]}<span>${short(date)}</span></h2>
        ${items.length ? items.map(rowHtml).join('') : '<div class="row"><div></div><div class="m">Nichts geplant</div><div></div></div>'}
      </section>`;
    })
    .join('') + `<p class="hint">Erzeugt am ${new Date(plan.created_at).toLocaleString('de-DE')}. <button class="ghost" id="regen">Woche neu erzeugen</button> <button class="primary" id="pdf">PDF / Drucken</button></p>`;
  $('#regen').onclick = regenerate;
  $('#pdf').onclick = openPdf;
  main.onclick = onPlanClick;
}

async function onPlanClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = Number(b.dataset.id);
  if (b.dataset.act === 'swap') {
    b.disabled = true;
    try {
      await api(`/api/items/${id}/swap`, { method: 'POST', body: {} });
      toast('Getauscht');
      await renderPlan($('#main'));
    } catch (err) {
      fail(err);
      b.disabled = false;
    }
  } else if (b.dataset.act === 'del') {
    b.disabled = true;
    try {
      await api(`/api/items/${id}`, { method: 'DELETE' });
      toast('Gelöscht');
      await renderPlan($('#main'));
    } catch (err) {
      fail(err);
      b.disabled = false;
    }
  } else if (b.dataset.act === 'edit') {
    openEditor(state.plan.items.find((i) => i.id === id));
  }
}

async function regenerate() {
  if (state.plan?.items?.length && !confirm('Die ganze Woche wird neu erzeugt. Deine manuellen Änderungen gehen dabei verloren. Fortfahren?')) return;
  try {
    await api('/api/regenerate', { method: 'POST', body: { week_start: state.week } });
    toast('Wird erzeugt – in ca. 1–2 Minuten neu laden');
  } catch (e) {
    alert(e.message);
  }
}

// ---------- Editor ----------
function sheet() { return $('#sheet'); }

function openEditor(item) {
  const dlg = sheet();
  const s = SLOT[item.slot];
  let servings = item.servings;
  dlg.innerHTML = `
    <div class="sheet-h"><h3>${s.ico} ${DAYS[item.day]} · ${s.label}</h3><button class="iconbtn" id="close" aria-label="Schließen">✕</button></div>
    <div class="sheet-b">
      <p><strong>${esc(itemTitle(item))}</strong></p>
      <h4>Portionen</h4>
      <div class="stepper"><button id="minus">−</button><strong id="srv">${servings}</strong><button id="plus">+</button></div>
      <h4>Notiz</h4>
      <input class="field" id="note" maxlength="200" value="${esc(item.note || '')}" placeholder="z. B. Bruder isst mit">
      <div class="actions"><button class="primary" id="saveMeta">Speichern</button></div>

      <h4>Vorschläge</h4>
      <div id="cands"><p class="hint">Lade …</p></div>

      <h4>Rezept suchen</h4>
      <div class="inline"><input class="field" id="q" placeholder="Suchbegriff (mind. 2 Zeichen)"><button class="ghost" id="doSearch">Suchen</button></div>
      <div id="results"></div>

      <h4>Eigener Eintrag</h4>
      <div class="inline"><input class="field" id="custom" maxlength="120" placeholder="z. B. Brot mit Frischkäse"><button class="ghost" id="setCustom">Setzen</button></div>

      <h4>Weitere Aktionen</h4>
      <div class="actions">
        ${item.slot === 'dinner' ? '<button class="ghost" id="hello">HelloFresh</button>' : ''}
        <button class="ghost" id="skip">Entfällt</button>
        ${item.recipe_id ? '<button class="ghost" id="like">👍 Mag ich</button><button class="ghost danger" id="never">🚫 Nie wieder</button>' : ''}
        <button class="ghost danger" id="remove">Eintrag löschen</button>
      </div>
    </div>`;
  dlg.showModal();

  const reload = async () => {
    dlg.close();
    await renderPlan($('#main'));
  };
  const put = async (body, msg) => {
    try {
      await api(`/api/items/${item.id}`, { method: 'PUT', body });
      toast(msg);
      await reload();
    } catch (e) { fail(e); }
  };
  const pickList = (list) => list.length
    ? list.map((r) => `<div class="cand">
        ${r.image ? `<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="${esc(r.image)}" alt="">` : '<div class="thumb"></div>'}
        <div><div class="t">${esc(r.title)}</div><div class="m">${r.minutes} min · ${esc(r.source)} · <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">ansehen</a></div></div>
        <button class="primary" data-pick="${r.id}">Nehmen</button></div>`).join('')
    : '<p class="hint">Nichts gefunden.</p>';
  const bindPicks = (root) => root.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => put({ recipe_id: Number(b.dataset.pick) }, 'Übernommen')));

  $('#close').onclick = () => dlg.close();
  $('#minus').onclick = () => { servings = Math.max(1, servings - 1); $('#srv').textContent = servings; };
  $('#plus').onclick = () => { servings = Math.min(12, servings + 1); $('#srv').textContent = servings; };
  $('#saveMeta').onclick = () => put({ servings, note: $('#note').value.trim() }, 'Gespeichert');
  $('#setCustom').onclick = () => { const v = $('#custom').value.trim(); if (v) put({ kind: 'custom', title: v }, 'Gesetzt'); };
  $('#skip').onclick = () => put({ kind: 'skip' }, 'Entfällt');
  $('#hello')?.addEventListener('click', () => put({ kind: 'placeholder', title: 'HelloFresh' }, 'HelloFresh'));
  $('#remove').onclick = async () => {
    try { await api(`/api/items/${item.id}`, { method: 'DELETE' }); toast('Gelöscht'); await reload(); } catch (e) { fail(e); }
  };
  const rate = async (rating, msg) => {
    try { await api(`/api/recipes/${item.recipe_id}/rate`, { method: 'POST', body: { rating } }); toast(msg); } catch (e) { fail(e); }
  };
  $('#like')?.addEventListener('click', () => rate(1, 'Wird künftig bevorzugt'));
  $('#never')?.addEventListener('click', async () => { await rate(-1, 'Kommt nie wieder vor'); try { await api(`/api/items/${item.id}/swap`, { method: 'POST', body: {} }); } catch { /* ok */ } await reload(); });
  const search = async () => {
    const q = $('#q').value.trim();
    if (q.length < 2) return;
    try {
      const { results } = await api(`/api/recipes/search?q=${encodeURIComponent(q)}&slot=${item.slot}`);
      $('#results').innerHTML = pickList(results);
      bindPicks($('#results'));
    } catch (e) { fail(e); }
  };
  $('#doSearch').onclick = search;
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  api(`/api/items/${item.id}/candidates`).then(({ candidates }) => {
    $('#cands').innerHTML = pickList(candidates);
    bindPicks($('#cands'));
  }).catch((e) => { $('#cands').innerHTML = `<p class="hint">${esc(e.message)}</p>`; });
}

// ---------- Vorbereitung ----------
const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const SLOT_NAME = { breakfast: 'Frühstück', lunch: 'Mittag', firma: 'Firma', snack: 'Snack', dinner: 'Abend' };

async function renderPrep(main) {
  const prep = await api(`/api/prep?week=${state.week}`);
  if (!prep.sessions.length && !prep.fresh.length && !prep.dinners.length) {
    main.innerHTML = '<p class="empty">Keine Vorbereitung – für diese Woche gibt es noch keinen Plan.</p>';
    return;
  }
  const key = `prep:${state.week}`;
  let checks = {};
  try { checks = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* leer */ }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(checks)); } catch { /* ignorieren */ } };
  const uses = (t) => t.uses.map((u) => `${DAY_SHORT[u.day]} ${SLOT_NAME[u.slot] || u.slot}`).join(', ');
  const line = (id, t, sub) => `<label class="${checks[id] ? 'done' : ''}"><input type="checkbox" data-k="${esc(id)}" ${checks[id] ? 'checked' : ''}>
    <span><span class="tt">${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.title)}</a>` : esc(t.title)}</span>
    <span class="sub">${esc(sub)}</span>${t.uses ? `<span class="for">für ${esc(uses(t))}</span>` : ''}</span></label>`;
  const sessions = prep.sessions.map((s) => {
    const total = s.tasks.reduce((a, t) => a + t.minutes, 0);
    return `<section class="sess"><h3>${esc(s.label)}<small>ca. ${total} min</small></h3>${s.tasks.map((t) => line(`${s.key}:${t.recipe_id}`, t, `${t.minutes} min · ${t.portions} Port.${t.tight ? ' · knapp haltbar' : ''}`)).join('')}</section>`;
  }).join('');
  const fresh = prep.fresh.length ? `<section class="sess alt"><h3>Frisch kurz vorher<small>kaum haltbar</small></h3>${prep.fresh.map((t) => line(`fresh:${t.recipe_id}`, t, `${t.minutes} min`)).join('')}</section>` : '';
  const dinners = prep.dinners.length ? `<section class="sess alt"><h3>Abendessen<small>frisch gekocht</small></h3>${prep.dinners.map((d) => line(`dinner:${d.day}:${d.recipe_id}`, { title: d.title }, `${DAYS[d.day]} · ${d.minutes} min · ${d.servings} Pers.`)).join('')}</section>` : '';
  const warn = prep.warnings.length ? `<div class="warnbox">${prep.warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div>` : '';
  main.innerHTML = `<div class="prep">${warn}${sessions}${fresh}${dinners}
    <div class="actions"><button class="ghost" id="reset">Haken zurücksetzen</button><button class="primary" id="pdf">PDF / Drucken</button></div></div>`;
  main.onchange = (e) => {
    const cb = e.target.closest('input[data-k]');
    if (!cb) return;
    if (cb.checked) checks[cb.dataset.k] = 1; else delete checks[cb.dataset.k];
    cb.parentElement.classList.toggle('done', cb.checked);
    save();
  };
  $('#reset').onclick = () => { checks = {}; save(); renderPrep(main); };
  $('#pdf').onclick = openPdf;
}

async function openPdf() {
  // Fenster sofort öffnen (Popup-Blocker), danach füllen
  const win = window.open('', '_blank');
  try {
    const bundle = await api(`/api/bundle?week=${state.week}`);
    const { renderPrintHtml } = await import('/printview.js');
    const html = renderPrintHtml({ week: state.week, items: bundle.items, shopping: bundle.shopping, prep: bundle.prep });
    if (!win) { toast('Popups sind blockiert – bitte erlauben'); return; }
    win.document.open();
    win.document.write(html + '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300))<\/script>');
    win.document.close();
  } catch (e) {
    win?.close();
    fail(e);
  }
}

// ---------- Einkauf ----------
async function renderShop(main) {
  const data = await api(`/api/shopping?week=${state.week}`);
  const key = `checks:${state.week}`;
  let checks = {};
  try { checks = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* leer */ }
  const save = () => { try { localStorage.setItem(key, JSON.stringify(checks)); } catch { /* ignorieren */ } };
  const line = (it) => `<label class="${checks[it.text] ? 'done' : ''}"><input type="checkbox" data-k="${esc(it.text)}" ${checks[it.text] ? 'checked' : ''}><span>${esc(it.text)}${it.when && it.when.length ? `<small class="when">${esc(it.when.join(' · '))}</small>` : ''}</span></label>`;

  if (!data.groups.length && !data.pantry.length) {
    main.innerHTML = '<p class="empty">Keine Einkaufsliste – für diese Woche gibt es noch keinen Plan.</p>';
    return;
  }
  main.innerHTML = `<div class="shop">
    <div class="actions"><button class="ghost" id="copy">📋 Liste kopieren</button><button class="ghost" id="reset">Haken zurücksetzen</button></div>
    ${data.groups.map((g) => `<h3>${esc(g.category)}</h3>${g.items.map(line).join('')}`).join('')}
    ${data.pantry.length ? `<details><summary>Vorrat (hast du vermutlich)</summary>${data.pantry.map(line).join('')}</details>` : ''}
    <p class="hint">Mengen sind gerundet. Mittagessen/Frühstück sind mit 80 % der Rezeptportion gerechnet.</p></div>`;
  main.onchange = (e) => {
    const cb = e.target.closest('input[data-k]');
    if (!cb) return;
    if (cb.checked) checks[cb.dataset.k] = 1; else delete checks[cb.dataset.k];
    cb.parentElement.classList.toggle('done', cb.checked);
    save();
  };
  $('#reset').onclick = () => { checks = {}; save(); renderShop(main); };
  $('#copy').onclick = async () => {
    const text = data.groups.map((g) => `${g.category}\n${g.items.map((i) => `- ${i.text}${i.when && i.when.length ? ` (${i.when.join(', ')})` : ''}`).join('\n')}`).join('\n\n');
    try { await navigator.clipboard.writeText(text); toast('Kopiert'); } catch { toast('Kopieren nicht möglich'); }
  };
}

// ---------- Wochen-Einstellungen ----------
async function renderWeek(main) {
  const { params, defaults, saved } = await api(`/api/params?week=${state.week}`);
  const p = JSON.parse(JSON.stringify(params));
  const sel = (key, d, min, max) => `<select data-k="${key}" data-d="${d}">${Array.from({ length: max - min + 1 }, (_, i) => min + i)
    .map((v) => `<option value="${v}" ${p[key][d] === v ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const chk = (key, d) => `<input type="checkbox" data-k="${key}" data-d="${d}" ${p[key][d] ? 'checked' : ''}>`;
  const rows = [
    ['Frühstück: Extra-Personen (Firma)', (d) => (d < 5 ? sel('breakfast_extras', d, 0, 4) : '–')],
    ['Mittag: Extra-Personen (Firma)', (d) => (d < 5 ? sel('lunch_extras', d, 0, 4) : '–')],
    ['Papa kocht selbst (Mittag)', (d) => (d < 5 ? chk('dad_cooks', d) : '–')],
    ['Bruder isst mit (alles kalt)', (d) => (d < 5 ? chk('brother', d) : '–')],
    ['Abendessen: Personen', (d) => sel('dinner_persons', d, 1, 3)],
    ['Abend = HelloFresh', (d) => chk('hellofresh', d)],
  ];
  main.innerHTML = `<div class="weekform">
    <table><thead><tr><th></th>${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, fn]) => `<tr><td>${label}</td>${[0, 1, 2, 3, 4, 5, 6].map((d) => `<td>${fn(d)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <div class="actions">
      <button class="primary" id="saveWeek">Für diese Woche speichern</button>
      <button class="ghost" id="saveDef">Als Standard für alle Wochen</button>
    </div>
    <p class="hint">${saved ? 'Für diese Woche gibt es eigene Werte.' : 'Es gelten die Standardwerte.'} Änderungen wirken sich auf neu erzeugte Pläne aus – danach „Woche neu erzeugen“ im Plan-Tab. Die Einkaufsmengen folgen den Portionen der Einträge.</p>
  </div>`;
  main.onchange = (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    p[el.dataset.k][Number(el.dataset.d)] = el.type === 'checkbox' ? el.checked : Number(el.value);
  };
  $('#saveWeek').onclick = async () => {
    try { await api('/api/params', { method: 'PUT', body: { week_start: state.week, params: p } }); toast('Gespeichert'); } catch (e) { fail(e); }
  };
  $('#saveDef').onclick = async () => {
    try { await api('/api/defaults', { method: 'PUT', body: { params: p } }); toast('Standard gespeichert'); } catch (e) { fail(e); }
  };
  void defaults;
}

// ---------- Start ----------
async function boot() {
  try {
    const s = await api('/api/session');
    state.currentWeek = s.current_week;
    if (!state.week) state.week = s.current_week;
    await render();
  } catch (e) {
    if (e.message !== 'Nicht angemeldet') $('#app').innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
