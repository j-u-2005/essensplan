const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Alle JSON-LD-Blöcke einer HTML-Seite (flach, inkl. @graph) */
export function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      try {
        data = JSON.parse(m[1].replace(/[\u0000-\u001f]+/g, ' ').trim());
      } catch {
        continue;
      }
    }
    flatten(data, out);
  }
  return out;
}

function flatten(node, out) {
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
  } else if (node && typeof node === 'object') {
    out.push(node);
    if (node['@graph']) flatten(node['@graph'], out);
  }
}

export function findRecipes(nodes) {
  return nodes.filter((n) => {
    const t = n['@type'];
    return Array.isArray(t) ? t.includes('Recipe') : t === 'Recipe';
  });
}

/** ISO-8601-Dauer (PT1H15M) → Minuten */
export function parseDuration(iso) {
  if (typeof iso !== 'string') return null;
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const minutes = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Math.round(Number(m[4] || 0) / 60);
  return minutes > 0 ? minutes : null;
}

export function parseYield(y) {
  const first = Array.isArray(y) ? y[0] : y;
  if (first === undefined || first === null) return null;
  const m = String(first).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1 && n <= 50 ? n : null;
}

function toList(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.flatMap(toList);
  if (typeof v === 'object') return toList(v.name ?? v.text ?? '');
  return String(v)
    .split(',')
    .map((s) => decodeEntities(s).trim())
    .filter(Boolean);
}

function imageUrl(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageUrl(img[0]);
  if (typeof img === 'object') return imageUrl(img.url ?? img.contentUrl ?? null);
  return null;
}

function instructionText(ins) {
  if (!ins) return '';
  if (typeof ins === 'string') return decodeEntities(ins.replace(/<[^>]+>/g, ' '));
  if (Array.isArray(ins)) return ins.map(instructionText).join(' ');
  if (typeof ins === 'object') {
    if (ins.itemListElement) return instructionText(ins.itemListElement);
    return instructionText(ins.text ?? ins.name ?? '');
  }
  return '';
}

/** schema.org/Recipe → schlankes Objekt; null, wenn unbrauchbar */
export function normalizeRecipe(node) {
  const title = decodeEntities(node.name || '').trim();
  const ingredients = (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : toList(node.recipeIngredient))
    .map((s) => decodeEntities(String(s)).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!title || ingredients.length < 2) return null;

  const prep = parseDuration(node.prepTime);
  const cook = parseDuration(node.cookTime);
  const total = parseDuration(node.totalTime) ?? (prep || cook ? (prep || 0) + (cook || 0) : null);

  return {
    title,
    image: imageUrl(node.image),
    servings: parseYield(node.recipeYield),
    minutes: total,
    prepMinutes: prep,
    cookMinutes: cook,
    ingredients,
    categories: [...toList(node.recipeCategory), ...toList(node.recipeCuisine)],
    keywords: toList(node.keywords),
    instructions: instructionText(node.recipeInstructions),
  };
}
