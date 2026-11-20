import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient, normalizeKey } from '../src/lib/ingredients.js';
import { extractJsonLd, findRecipes, normalizeRecipe, parseDuration, parseYield } from '../src/lib/jsonld.js';
import { parseRobots, isAllowed, crawlDelay } from '../src/lib/robots.js';
import { parseSitemapXml } from '../src/lib/sitemap.js';
import { classifyRecipe } from '../src/lib/classify.js';

test('Zutaten werden zerlegt', () => {
  assert.deepEqual(parseIngredient('200 g Mehl'), { a: 200, u: 'g', n: 'Mehl' });
  assert.deepEqual(parseIngredient('1,5 kg Kartoffeln'), { a: 1500, u: 'g', n: 'Kartoffeln' });
  assert.deepEqual(parseIngredient('½ l Milch'), { a: 500, u: 'ml', n: 'Milch' });
  assert.deepEqual(parseIngredient('2 EL Olivenöl'), { a: 2, u: 'EL', n: 'Olivenöl' });
  assert.deepEqual(parseIngredient('2-3 Zwiebeln'), { a: 2.5, u: null, n: 'Zwiebeln' });
  assert.deepEqual(parseIngredient('1 Dose Tomaten (400 g), gehackt'), { a: 1, u: 'Dose', n: 'Tomaten' });
  assert.deepEqual(parseIngredient('1 1/2 Tassen Reis'), { a: 1.5, u: 'Tasse', n: 'Reis' });
  assert.deepEqual(parseIngredient('Salz und Pfeffer'), { a: null, u: null, n: 'Salz und Pfeffer' });
});

test('Zutaten-Schlüssel fasst Varianten zusammen', () => {
  assert.equal(normalizeKey('Zwiebeln'), normalizeKey('Zwiebel'));
  assert.equal(normalizeKey('frische Tomaten'), normalizeKey('Tomaten'));
});

test('Dauer und Portionen', () => {
  assert.equal(parseDuration('PT1H15M'), 75);
  assert.equal(parseDuration('PT45M'), 45);
  assert.equal(parseDuration('P1DT2H'), 1560);
  assert.equal(parseDuration('kaputt'), null);
  assert.equal(parseYield('4 Portionen'), 4);
  assert.equal(parseYield(['6', '6 Stück']), 6);
  assert.equal(parseYield(undefined), null);
});

const html = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},
{"@type":["Recipe"],"name":"Linsen-Curry &amp; Reis","image":{"url":"https://example.org/a.jpg"},
"recipeYield":"4 Portionen","totalTime":"PT35M","prepTime":"PT10M","recipeCategory":"Hauptspeise","keywords":"vegan, schnell",
"recipeIngredient":["250 g rote Linsen","1 Dose Kokosmilch","2 TL Curry","200 g Reis"],
"recipeInstructions":[{"@type":"HowToStep","text":"Kochen."}]}]}</script>
<script type="application/ld+json">{kaputt</script>
</head></html>`;

test('JSON-LD-Rezept wird gefunden und normalisiert', () => {
  const rec = findRecipes(extractJsonLd(html)).map(normalizeRecipe).find(Boolean);
  assert.equal(rec.title, 'Linsen-Curry & Reis');
  assert.equal(rec.image, 'https://example.org/a.jpg');
  assert.equal(rec.servings, 4);
  assert.equal(rec.minutes, 35);
  assert.equal(rec.prepMinutes, 10);
  assert.equal(rec.ingredients.length, 4);
  assert.deepEqual(rec.keywords, ['vegan', 'schnell']);
});

test('Seiten ohne Rezept liefern nichts', () => {
  assert.equal(findRecipes(extractJsonLd('<html></html>')).length, 0);
  assert.equal(normalizeRecipe({ name: 'x', recipeIngredient: ['a'] }), null);
});

test('robots.txt', () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /suche
Disallow: /intern/
Allow: /intern/offen
Crawl-delay: 5

User-agent: BadBot
Disallow: /

Sitemap: https://example.org/sitemap.xml`);
  const ua = 'EssensplanBot/1.0 (+x)';
  assert.equal(isAllowed(robots, '/rezepte/pasta', ua), true);
  assert.equal(isAllowed(robots, '/suche?q=a', ua), false);
  assert.equal(isAllowed(robots, '/intern/geheim', ua), false);
  assert.equal(isAllowed(robots, '/intern/offen', ua), true);
  assert.equal(isAllowed(robots, '/x', 'BadBot/2'), false);
  assert.equal(crawlDelay(robots, ua), 5);
  assert.deepEqual(robots.sitemaps, ['https://example.org/sitemap.xml']);
});

test('Sitemap und Sitemap-Index', () => {
  assert.deepEqual(parseSitemapXml('<urlset><url><loc>https://a.de/1?x=1&amp;y=2</loc></url><url><loc>https://a.de/2</loc></url></urlset>'),
    { sitemaps: [], urls: ['https://a.de/1?x=1&y=2', 'https://a.de/2'] });
  assert.deepEqual(parseSitemapXml('<sitemapindex><sitemap><loc><![CDATA[https://a.de/s1.xml]]></loc></sitemap></sitemapindex>'),
    { sitemaps: ['https://a.de/s1.xml'], urls: [] });
});

const rec = (title, ing, extra = {}) => ({ title, ingredients: ing, categories: [], keywords: [], minutes: 30, ...extra });

test('Einordnung nach Mahlzeit', () => {
  const oats = classifyRecipe(rec('Overnight Oats mit Beeren', ['50 g Haferflocken', '150 g Joghurt', '100 g Beeren']));
  assert.equal(oats.s_breakfast, 1);
  assert.equal(oats.oats, 1);
  assert.equal(oats.sweet, 1);
  assert.equal(oats.cold_ok, 1);
  assert.equal(oats.s_dinner, 0);

  const salat = classifyRecipe(rec('Nudelsalat mit Gemüse', ['250 g Nudeln', '2 Möhren', '1 Gurke', '100 g Mais', '3 EL Joghurt']));
  assert.equal(salat.s_lunch, 1);
  assert.equal(salat.cold_ok, 1);

  const suppe = classifyRecipe(rec('Kürbissuppe', ['500 g Kürbis', '1 Zwiebel', '500 ml Brühe', '100 ml Sahne']));
  assert.equal(suppe.cold_ok, 0);
  assert.equal(suppe.micro_ok, 1);
  assert.ok(suppe.shelf_days >= 4);
  assert.equal(suppe.dtype, 'suppe');

  const riegel = classifyRecipe(rec('Energy-Riegel mit Datteln', ['100 g Datteln', '100 g Haferflocken']));
  assert.equal(riegel.s_snack, 1);
  assert.equal(riegel.fructose, 1);

  const huhn = classifyRecipe(rec('Hähnchen-Reispfanne', ['400 g Hähnchenbrust', '200 g Reis', '1 Zucchini', '1 Zwiebel']));
  assert.equal(huhn.s_dinner, 1);
  assert.equal(huhn.protein, 'huhn');
  assert.equal(huhn.cost, 2);
});
