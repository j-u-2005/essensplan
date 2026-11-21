/**
 * Regelbasierte Einordnung eines Rezepts (kein KI-Einsatz).
 * Eingabe: { title, categories[], keywords[], ingredients[] (Rohzeilen), minutes, prepMinutes, cookMinutes }
 */
const low = (s) => String(s || '').toLowerCase();

const MAIN = /(fleisch|hack|hähnchen|hühnchen|huhn|pute|nudel|pasta|spaghetti|reis|suppe|eintopf|curry|auflauf|steak|schnitzel|lasagne|burger|pizza|gulasch|braten|gratin|pfanne|risotto|quiche|ofengemüse|kartoffel|gnocchi|burrito|wrap|bowl|chili|bolognese|frikadelle|bratwurst|püree|tortilla|dal|linsen)/u;
const BREAKFAST = /(frühstück|müsli|porridge|overnight|oats|haferflocken|pancake|pfannkuchen|waffel|french toast|granola|chia|bircher|crêpe|crepe|milchreis|grießbrei|griesbrei|aufstrich|bananenbrot|marmelade|brötchen|toast|joghurt|quark|smoothie)/u;
const SNACK = /(riegel|energy|kugeln|cookie|keks|muffin|cracker|chips|snack|popcorn|trail|smoothie|obstsalat|fruchtsalat|bananenbrot|brownie|bliss|ballchen|energyball|protein ?ball)/u;
// Getränke, Saucen, Dips, Dressings & Co. sind keine Mahlzeiten und gehören in keinen Slot
const NON_MEAL = /(cocktail|longdrink|drink\b|bowle|punsch|glühwein|likör|limonade|getränk|mocktail|spritz|sangria|eistee|tee\b|kaffee|latte|sirup|shot\b|dip\b|dip$|-dip|dips\b|dressing|vinaigrette|sauce|soße|marinade|pesto|gewürzmischung|brühe|fond\b|chutney|mayonnaise|ketchup|aioli|hummus|guacamole|salsa|aufstrich|butter\b|würzöl|likör)/u;
// Zu ausgefallen für den Alltag (Fabian: "rote Bete Fussili mit Erbsensoße? wth?") – keine Zuordnung
const QUIRKY = /(rote bete|rote beete|rotebete|beetroot|pastinake|topinambur|schwarzwurzel|fenchel|mangold|steckrübe|kohlrabi|spirulina|lakritz|wasabi|tamarinde|rosenwasser|erbsensoße|erbsensauce|erbsenpesto|süßkartoffel-?pasta|blaubeer-?(pasta|nudel)|schoko-?(pasta|nudel|curry))/u;
// Abendessen soll warm sein
const COLD_DINNER = /(salat|bowl|overnight|bircher|smoothie|müsli|sandwich|belegt|carpaccio|tatar|sushi|rohkost|brotzeit|vesper|dip\b)/u;
const DESSERT = /(dessert|nachtisch|kuchen|torte|\beis\b|pudding|mousse|plätzchen|kekse|brownie|cupcake|süßspeise|tiramisu|cheesecake|sorbet|parfait)/u;
const LUNCH = /(salat|bowl|wrap|sandwich|suppe|eintopf|auflauf|nudel|pasta|reis|curry|quiche|frittata|burrito|linsen|couscous|bulgur|pfanne|lasagne|gratin|tortilla|focaccia|pizza|baguette|bratling|frikadelle|bällchen|laibchen|taschen|strudel|börek|tarte|mittag|dal|chili)/u;
const SWEET = /(süß|honig|zucker|schoko|beere|banane|apfel|zimt|vanille|ahornsirup|marmelade|kokos|obst|joghurt|quark|milchreis|pancake|waffel|porridge|müsli|granola|crêpe|crepe|grießbrei|griesbrei|bananenbrot|muffin|kuchen|keks|haselnuss|pfirsich|erdbeer|heidelbeer|himbeer|kirsch|bircher|overnight)/u;
const SAVORY = /(rührei|käse|schinken|wurst|speck|avocado|gemüse|herzhaft|hack|ei\b)/u;
const RAW_CONTEXT = /(salat|sandwich|wrap|burger|bowl|brot|belegt|bruschetta|carpaccio|tatar|rohkost|dip|dressing|smoothie|shake|overnight|bircher|müsli|tramezzini|baguette|toast|taco|burrito|fajita|döner|gyros|sushi|sommerrolle|snack)/u;
const COLD = /(salat|wrap|sandwich|bowl|quiche|pizza|focaccia|frikadelle|bällchen|laibchen|bratling|baguette|brot|belegt|tortilla|rolle|overnight|müsli|joghurt|quark|muffin|riegel|ball|kuchen|obst|dip|granola|bircher|chia|cracker|cookie|keks)/u;
const WARM_ONLY = /(suppe|eintopf|auflauf|gratin|curry|braten|risotto|gulasch|porridge|milchreis|grießbrei|griesbrei|rührei|omelett|french toast|püree|chili|dal\b|pfannkuchen|waffel)/u;
const NO_MICRO = /(soufflé|spiegelei|omelett|knusprig|frittiert|schnitzel|pommes|backfisch|crêpe|crepe|waffel|pancake|pfannkuchen)/u;
const OATS = /(hafer|oat|porridge|overnight|bircher|granola|müsli)/u;
const FRUCTOSE = /(honig|agave|apfelsaft|apfel(?!saft)|äpfel|birne|trockenfrüchte|rosine|dattel|traube|süßkirsche|mango|wassermelone|zwetschge|pflaume|obstsaft|apfelmus|ahornsirup|sirup)/u;
const EXPENSIVE = /(rind|lamm|steak|entrecôte|filet|garnele|lachs|ente\b|wild|kalb|serrano|prosciutto|parmaschinken|pinienkerne|avocado|cashew|mandel|nüsse)/gu;

// Gerichte, die man vorkocht und in der Firma nur noch aufwärmt (ca. 5 Minuten)
const FIRMA_TYPES = ['suppe', 'reis', 'auflauf', 'pasta', 'pfanne', 'kartoffel'];

const PROTEINS = [
  ['huhn', /(hähnchen|hühnchen|huhn|pute|geflügel|chicken)/u],
  ['hack', /(hackfleisch|\bhack\b|gehacktes|bolognese|frikadelle|bällchen|burger)/u],
  ['rind', /(rind|steak|gulasch)/u],
  ['schwein', /(schwein|speck|bacon|schinken|wurst|bratwurst|salami|kasseler)/u],
  ['ei', /(\beier\b|\bei\b|rührei|omelett|frittata)/u],
  ['kaese', /(käse|mozzarella|ricotta|quark|skyr)/u],
];

const DTYPES = [
  ['salat', /salat/u],
  ['suppe', /(suppe|eintopf)/u],
  ['pasta', /(nudel|pasta|spaghetti|lasagne|gnocchi|penne)/u],
  ['reis', /(reis|risotto|curry|dal\b)/u],
  ['auflauf', /(auflauf|gratin|quiche|tarte|pizza)/u],
  ['wrap', /(wrap|burrito|tortilla|sandwich|burger|baguette|taco|fladen)/u],
  ['bowl', /bowl/u],
  ['pfanne', /(pfanne|wok|geschnetzelt|gulasch)/u],
  ['kartoffel', /(kartoffel|püree|ofengemüse)/u],
];

export function rawContext(title, categories = []) {
  return RAW_CONTEXT.test(low(title) + ' ' + low(categories.join(' ')));
}

function pickProtein(text) {
  for (const [name, re] of PROTEINS) if (re.test(text)) return name;
  return 'veg';
}

function pickDtype(text) {
  for (const [name, re] of DTYPES) if (re.test(text)) return name;
  return 'sonstiges';
}

function estimateShelf(text) {
  if (/(granola|müsli|riegel|cookie|keks|cracker)/u.test(text) && !/overnight|bircher/u.test(text)) return 7;
  if (/(suppe|eintopf|curry|chili|auflauf|lasagne|gulasch|dal\b|bolognese)/u.test(text)) return 4;
  if (/(nudelsalat|reissalat|couscous|bulgur|linsensalat|kartoffelsalat)/u.test(text)) return 3;
  if (/(overnight|bircher|chia)/u.test(text)) return 3;
  if (/(muffin|kuchen|bananenbrot|brownie)/u.test(text)) return 4;
  if (/(pancake|waffel|pfannkuchen|crêpe|crepe|rührei|omelett)/u.test(text)) return 1;
  if (/salat/u.test(text)) return 2;
  return 3;
}

function estimateEffort(r, minutes, text) {
  if (r.prepMinutes) return Math.max(5, Math.min(r.prepMinutes, minutes));
  if (/(overnight|bircher)/u.test(text)) return 5;
  if (r.cookMinutes && minutes > r.cookMinutes) return Math.max(10, minutes - r.cookMinutes);
  if (minutes > 180) return Math.min(45, Math.round(minutes * 0.4));
  return Math.max(5, Math.round(minutes * 0.6));
}

export function classifyRecipe(r) {
  const title = low(r.title);
  const cats = low([...(r.categories || []), ...(r.keywords || [])].join(' '));
  const text = `${title} ${cats}`;
  const ing = low((r.ingredients || []).join(' | '));
  const minutes = r.minutes && r.minutes > 0 ? Math.min(r.minutes, 1440) : 45;

  const nonMeal = NON_MEAL.test(title) || QUIRKY.test(title) || QUIRKY.test(ing);
  const dessert = DESSERT.test(text) && !SNACK.test(text);
  const mainish = MAIN.test(title) || MAIN.test(cats);
  const bf = !nonMeal && (BREAKFAST.test(title) || /frühstück/u.test(cats)) && !mainish;
  const snack = !nonMeal && SNACK.test(title) && !mainish;
  const proteinIng = PROTEINS.some(([, re]) => re.test(ing));

  const protein = pickProtein(`${title} ${ing}`);
  const dtype = pickDtype(text);
  const shelf = estimateShelf(text);

  const sweet = (bf || snack) && SWEET.test(title) && !SAVORY.test(title);
  const sDinner = !nonMeal && !COLD_DINNER.test(title) && !dessert && !bf && !snack && (mainish || (proteinIng && (r.ingredients || []).length >= 4));
  const sLunch =
    !nonMeal && !dessert && !bf && !snack && (LUNCH.test(text) || /mittag/u.test(cats) || (sDinner && shelf >= 3));

  const warmOnly = WARM_ONLY.test(title);
  const coldOk = bf ? !warmOnly : COLD.test(text) && !warmOnly;
  const microOk = !NO_MICRO.test(text);
  const oats = OATS.test(title) || /haferflocken|haferdrink/u.test(ing);
  const fructose = FRUCTOSE.test(ing + ' ' + title);

  const expensiveHits = (ing.match(EXPENSIVE) || []).length;
  const meat = protein === 'huhn' || protein === 'hack' || protein === 'schwein' || protein === 'rind';
  const cost = expensiveHits >= 2 ? 3 : expensiveHits === 1 || meat ? 2 : 1;

  return {
    minutes,
    effort: estimateEffort(r, minutes, text),
    s_breakfast: bf ? 1 : 0,
    s_lunch: sLunch ? 1 : 0,
    s_snack: snack ? 1 : 0,
    s_dinner: sDinner ? 1 : 0,
    cold_ok: coldOk ? 1 : 0,
    micro_ok: microOk ? 1 : 0,
    shelf_days: shelf,
    batch_ok: shelf >= 3 ? 1 : 0,
    sweet: sweet ? 1 : 0,
    oats: oats ? 1 : 0,
    fructose: fructose ? 1 : 0,
    cost,
    protein,
    dtype,
    leftover_ok: shelf >= 3 && microOk ? 1 : 0,
    s_firma: (sLunch || sDinner) && microOk && shelf >= 3 && FIRMA_TYPES.includes(dtype) ? 1 : 0,
  };
}
