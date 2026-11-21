import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecipe } from '../src/lib/classify.js';

const six = ['1 Limette', '4 cl Rum', '2 TL Zucker', '100 ml Soda', 'Eiswürfel', 'Minze', '1 Stk Ingwer'];

test('Cocktails, Dips und Saucen landen in keinem Slot', () => {
  for (const title of ['Mojito Cocktail', 'Apfel-Dip mit Zimt', 'Joghurt-Dressing', 'Tomatensauce', 'Winterpunsch', 'Hummus']) {
    const c = classifyRecipe({ title, ingredients: six, minutes: 10 });
    assert.deepEqual([c.s_breakfast, c.s_lunch, c.s_snack, c.s_dinner, c.s_firma], [0, 0, 0, 0, 0], title);
  }
});

test('Echte Gerichte bleiben erhalten', () => {
  assert.equal(classifyRecipe({ title: 'Waffeln mit Beeren', ingredients: six, minutes: 25 }).s_breakfast, 1);
  assert.equal(classifyRecipe({ title: 'Linsensuppe', ingredients: six, minutes: 40 }).s_lunch, 1);
  assert.equal(classifyRecipe({ title: 'Energy Balls', ingredients: six, minutes: 15 }).s_snack, 1);
});

test('Abendessen: warm und nicht zu ausgefallen', () => {
  const ing = ['300 g Fusilli', '400 g rote Bete', '150 g Erbsen', '1 Zwiebel', '2 Knoblauchzehen'];
  const beet = classifyRecipe({ title: 'Rote-Bete-Fusilli mit Erbsensoße', ingredients: ing, minutes: 30 });
  assert.deepEqual([beet.s_lunch, beet.s_dinner, beet.s_firma], [0, 0, 0]);
  const salat = classifyRecipe({ title: 'Nudelsalat mit Schinken', ingredients: ['300 g Nudeln', '150 g Schinken', '1 Gurke', '2 EL Öl'], minutes: 20 });
  assert.equal(salat.s_dinner, 0);
  const ok = classifyRecipe({ title: 'Hähnchen-Curry mit Reis', ingredients: ['400 g Hähnchen', '200 g Reis', '1 Dose Kokosmilch', '2 EL Currypaste'], minutes: 35 });
  assert.equal(ok.s_dinner, 1);
});

test('Frühstück süß, Mittag/Abend herzhaft', () => {
  const ing = ['2 Eier', '200 g Mehl', '250 ml Milch', '1 EL Zucker', '1 Prise Salz'];
  const waffel = classifyRecipe({ title: 'Waffeln mit Beeren', ingredients: ing, minutes: 25 });
  assert.equal(waffel.s_breakfast, 1);
  assert.deepEqual([waffel.s_lunch, waffel.s_dinner], [0, 0]);
  const herz = classifyRecipe({ title: 'Rührei mit Schinken', ingredients: ing, minutes: 10 });
  assert.equal(herz.s_breakfast, 0);
  const kartoffel = classifyRecipe({ title: 'Süßkartoffel-Curry mit Reis', ingredients: ['400 g Süßkartoffel', '200 g Reis', '1 Dose Kokosmilch', '2 EL Currypaste'], minutes: 35 });
  assert.equal(kartoffel.s_dinner, 1);
});
