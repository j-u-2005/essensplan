// Exportiert alle Rezepte (ohne gesperrte) als JSON zur manuellen Prüfung: out/recipes-export.json
import { mkdir, writeFile } from 'node:fs/promises';
import { d1 } from './d1.mjs';

const rows = [];
for (let offset = 0; ; offset += 500) {
  const chunk = await d1(
    `SELECT id, url, source, title, minutes, servings, s_breakfast AS b, s_lunch AS l, s_dinner AS d, s_firma AS f, ingredients
       FROM recipes WHERE blocked = 0 ORDER BY id LIMIT 500 OFFSET ?`,
    [offset],
  );
  if (!chunk.length) break;
  for (const r of chunk) {
    let names = [];
    try {
      names = JSON.parse(r.ingredients).map((i) => i.n).slice(0, 14);
    } catch { /* leer */ }
    rows.push({ id: r.id, url: r.url, src: r.source, title: r.title, min: r.minutes, srv: r.servings, b: r.b, l: r.l, d: r.d, f: r.f, ing: names });
  }
}
await mkdir('out', { recursive: true });
await writeFile('out/recipes-export.json', JSON.stringify(rows));
console.log(`${rows.length} Rezepte exportiert.`);
