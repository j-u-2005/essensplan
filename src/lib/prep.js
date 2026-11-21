import { DAY_SHORT } from './dates.js';

const SLOT_LABEL = { breakfast: 'Frühstück', lunch: 'Mittag', firma: 'Firma', snack: 'Snack', dinner: 'Abendessen' };
export const SESSION_SUN = -1; // Sonntag vor der Woche

const slotLabel = (slot) => SLOT_LABEL[slot] || slot;

/**
 * Vorbereitungsplan: Sonntag + kurze Session am Mittwochabend (rules.prep.midweek_day).
 *
 * items:   [{ id, day, slot, kind, recipe_id, servings, leftover }]
 * recipes: Map recipe_id → { title, url, effort, shelf_days, servings }
 * Rückgabe: { sessions, fresh, dinners, usage, warnings }
 *   usage: Map recipe_id → [{ text, rank }]  (wann die Zutaten gebraucht werden)
 */
export function buildPrepPlan(items, recipes, rules) {
  const cfg = rules.prep || { sunday_max_minutes: 120, midweek_max_minutes: 60, midweek_day: 2 };
  const mid = cfg.midweek_day;
  const warnings = [];
  const usage = new Map();
  const addUsage = (rid, text, rank) => {
    const list = usage.get(rid) || [];
    if (!list.some((u) => u.text === text)) list.push({ text, rank });
    usage.set(rid, list);
  };

  // Abendessen werden frisch gekocht
  const dinners = items
    .filter((i) => i.slot === 'dinner' && i.kind === 'recipe' && i.recipe_id)
    .sort((a, b) => a.day - b.day)
    .map((i) => {
      const r = recipes.get(i.recipe_id);
      addUsage(i.recipe_id, `${DAY_SHORT[i.day]} Abend kochen`, i.day * 10 + 5);
      return { day: i.day, recipe_id: i.recipe_id, title: r?.title ?? '?', minutes: r?.effort ?? 0, servings: i.servings };
    });

  // Alles andere (Frühstück, Mittag, Firma, Snack), außer Reste vom Abendessen
  const groups = new Map();
  const fresh = [];
  for (const i of items) {
    if (i.kind !== 'recipe' || !i.recipe_id || i.slot === 'dinner' || i.leftover) continue;
    if (i.day >= 5) {
      // Wochenende: wird am Tag selbst frisch zubereitet
      const r = recipes.get(i.recipe_id) || { title: '?', effort: 15 };
      fresh.push({ recipe_id: i.recipe_id, title: r.title, url: r.url, minutes: r.effort ?? 15, portions: i.servings, uses: [{ day: i.day, slot: i.slot, servings: i.servings }] });
      addUsage(i.recipe_id, `${DAY_SHORT[i.day]} frisch zubereiten`, i.day * 10 + 1);
      continue;
    }
    const g = groups.get(i.recipe_id) || { recipe_id: i.recipe_id, uses: [], portions: 0 };
    g.uses.push({ day: i.day, slot: i.slot, servings: i.servings });
    g.portions += i.servings;
    groups.set(i.recipe_id, g);
  }

  const sunday = { key: 'sun', label: 'Sonntag', day: SESSION_SUN, total: 0, tasks: [] };
  const midweek = { key: 'mid', label: `${DAY_SHORT[mid]}-Abend`, day: mid, total: 0, tasks: [] };

  const useText = (u) => `${DAY_SHORT[u.day]} ${slotLabel(u.slot)}`;

  for (const g of groups.values()) {
    const r = recipes.get(g.recipe_id) || { title: '?', effort: 15, shelf_days: 3 };
    const days = g.uses.map((u) => u.day);
    const first = Math.min(...days);
    const last = Math.max(...days);
    const shelf = r.shelf_days ?? 3;
    const effort = r.effort ?? 15;
    const base = { recipe_id: g.recipe_id, title: r.title, url: r.url, minutes: effort, portions: g.portions, uses: g.uses.sort((a, b) => a.day - b.day || a.slot.localeCompare(b.slot)) };

    if (shelf <= 1) {
      fresh.push(base);
      addUsage(g.recipe_id, `${DAY_SHORT[first]} frisch zubereiten`, first * 10 + 1);
      continue;
    }
    const sundayOk = last - SESSION_SUN <= shelf;
    const midOk = first > mid && last - mid <= shelf;
    let target;
    if (first <= mid) target = 'sun';
    else target = midOk ? 'mid' : 'sun';
    const task = { ...base, session: target, tight: target === 'sun' ? !sundayOk : !midOk };
    (target === 'sun' ? sunday : midweek).tasks.push(task);
    if (task.tight) warnings.push(`„${r.title}“ ist laut Schätzung knapp haltbar (${shelf} Tage) und wird bis ${DAY_SHORT[last]} gebraucht.`);
  }

  // Mittwochsession zu lang → Aufgaben auf Sonntag verschieben, wenn sie dort haltbar genug sind
  const total = (s) => s.tasks.reduce((a, t) => a + t.minutes, 0);
  const movable = (t) => t.uses.reduce((m, u) => Math.max(m, u.day), 0) - SESSION_SUN <= (recipes.get(t.recipe_id)?.shelf_days ?? 3);
  midweek.tasks.sort((a, b) => b.minutes - a.minutes);
  for (const t of [...midweek.tasks]) {
    if (total(midweek) <= cfg.midweek_max_minutes) break;
    if (!movable(t)) continue;
    midweek.tasks.splice(midweek.tasks.indexOf(t), 1);
    t.session = 'sun';
    t.tight = false;
    sunday.tasks.push(t);
  }
  sunday.total = total(sunday);
  midweek.total = total(midweek);
  if (sunday.total > cfg.sunday_max_minutes) warnings.push(`Sonntag: ca. ${sunday.total} min geschätzt (Ziel: höchstens ${cfg.sunday_max_minutes}).`);
  if (midweek.total > cfg.midweek_max_minutes) warnings.push(`${midweek.label}: ca. ${midweek.total} min geschätzt (Ziel: höchstens ${cfg.midweek_max_minutes}).`);

  for (const session of [sunday, midweek]) {
    session.tasks.sort((a, b) => Math.min(...a.uses.map((u) => u.day)) - Math.min(...b.uses.map((u) => u.day)) || b.minutes - a.minutes);
    for (const t of session.tasks) {
      const label = session.key === 'sun' ? 'So Vorbereitung' : `${DAY_SHORT[mid]} Vorbereitung`;
      addUsage(t.recipe_id, label, session.day * 10);
    }
  }

  const sessions = [sunday, midweek].filter((s) => s.tasks.length);
  fresh.sort((a, b) => a.uses[0].day - b.uses[0].day);
  return { sessions, fresh, dinners, usage, warnings };
}
