import { buildPrepPlan } from './prep.js';
import { buildShopping } from './shopping.js';

/**
 * Berechnet Vorbereitungsplan und Einkaufsliste aus den Plan-Einträgen.
 * items:   Zeilen aus plan_items (day, slot, kind, recipe_id, servings, leftover)
 * recipes: Zeilen mit id, title, url, effort, shelf_days, servings, ingredients (JSON-String oder Array)
 */
export function assembleWeek(items, recipeRows, rules) {
  const byId = new Map();
  for (const r of recipeRows) {
    byId.set(r.id, {
      title: r.title,
      url: r.url,
      effort: r.effort,
      shelf_days: r.shelf_days,
      servings: r.servings,
      ingredients: typeof r.ingredients === 'string' ? JSON.parse(r.ingredients) : r.ingredients || [],
    });
  }
  const prep = buildPrepPlan(items, byId, rules);

  const perRecipe = new Map();
  for (const i of items) {
    if (i.kind !== 'recipe' || !i.recipe_id || !byId.has(i.recipe_id)) continue;
    const factor = i.servings * (i.slot === 'dinner' ? 1 : rules.lunch_portion_factor);
    const e = perRecipe.get(i.recipe_id);
    if (e) e.factor += factor;
    else {
      const r = byId.get(i.recipe_id);
      perRecipe.set(i.recipe_id, { servings: r.servings, factor, ingredients: r.ingredients, labels: prep.usage.get(i.recipe_id) || [] });
    }
  }
  const shopping = buildShopping([...perRecipe.values()], rules);

  const { usage, ...prepOut } = prep;
  return { prep: prepOut, shopping };
}
