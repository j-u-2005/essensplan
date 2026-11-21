/**
 * Sperrliste. Muster-Kurzschreibweise: "<" = kein Buchstabe davor, ">" = kein Buchstabe danach.
 * Modi:
 *  always – Zutat (oder Titel) führt immer zum Ausschluss
 *  raw    – nur, wenn die Zutat roh gegessen wird (Salat/Sandwich/… oder Hinweis in der Zeile)
 *  large  – nur, wenn das Gemüse in großen Stücken vorkommt
 */
const expand = (p) => p.replaceAll('<', '(?<![\\p{L}])').replaceAll('>', '(?![\\p{L}])');
const rx = (p) => (p ? new RegExp(expand(p), 'iu') : null);

const RAW_LINE = /(roh|zum (belegen|garnieren|servieren|dekorieren|anrichten)|in scheiben|als topping)/iu;

export function compileBlocklist(entries) {
  return entries.map((e) => ({
    ...e,
    re: rx(e.pattern),
    allowRe: rx(e.allow),
    largeRe: rx(e.large),
    rawLineRe: rx(e.rawLine),
    titleRe: rx(e.titlePattern),
  }));
}

/**
 * recipe: { title, ingredients: string[] (Rohzeilen), rawContext: boolean }
 * → { blocked, reasons: string[] }
 */
export function checkRecipe(recipe, compiled) {
  const reasons = new Set();
  const title = recipe.title || '';
  const lines = recipe.ingredients || [];

  for (const e of compiled) {
    if (e.titleRe && e.titleRe.test(title)) {
      reasons.add(e.label);
      continue;
    }
    if (e.mode === 'always') {
      if (e.re.test(title) && !(e.allowRe && e.allowRe.test(title))) reasons.add(e.label);
      for (const line of lines) {
        if (e.re.test(line) && !(e.allowRe && e.allowRe.test(line))) reasons.add(e.label);
      }
    } else if (e.mode === 'raw') {
      for (const line of lines) {
        if (!e.re.test(line) || (e.allowRe && e.allowRe.test(line))) continue;
        if (recipe.rawContext || RAW_LINE.test(line) || (e.rawLineRe && e.rawLineRe.test(line))) reasons.add(e.label);
      }
    } else if (e.mode === 'large') {
      for (const line of lines) {
        if (!e.re.test(line) || (e.allowRe && e.allowRe.test(line))) continue;
        if (recipe.rawContext || (e.largeRe && e.largeRe.test(line))) reasons.add(e.label);
      }
    }
  }
  return { blocked: reasons.size > 0, reasons: [...reasons] };
}
