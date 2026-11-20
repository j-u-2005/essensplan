import test from 'node:test';
import assert from 'node:assert/strict';
import { compileBlocklist, checkRecipe } from '../src/lib/blocklist.js';
import { rawContext } from '../src/lib/classify.js';
import { blocklistConfig } from './helpers.mjs';

const bl = compileBlocklist(blocklistConfig);
const check = (title, ingredients, categories = []) =>
  checkRecipe({ title, ingredients, rawContext: rawContext(title, categories) }, bl);

test('harte Sperren greifen', () => {
  for (const [title, lines] of [
    ['Lachs-Pasta', ['200 g Nudeln', '150 g Räucherlachs']],
    ['Garnelenpfanne', ['300 g Garnelen', '1 Zwiebel']],
    ['Reispfanne', ['200 g Champignons', '1 Tasse Reis']],
    ['Salat', ['100 g Feta', '1 Salatherz']],
    ['Brot', ['2 EL Senf', '4 Scheiben Brot']],
    ['Pizza', ['100 g Oliven, schwarz', '1 Teig']],
    ['Curry', ['400 g Kichererbsen', '1 Dose Kokosmilch']],
    ['Chili', ['1 Dose Kidneybohnen', '300 g Hack']],
    ['Eintopf', ['1 Dose weiße Bohnen', '2 Möhren']],
    ['Auflauf', ['150 g Ziegenkäse', '2 Kartoffeln']],
    ['Nudeln', ['50 g Parmesan, gerieben', '250 g Spaghetti']],
    ['Smoothie', ['1 Mango', '200 ml Milch']],
    ['Gemüse', ['300 g Rosenkohl', '1 EL Öl']],
  ]) {
    assert.equal(check(title, lines).blocked, true, title);
  }
});

test('Ausnahmen: Mozzarella, Muschelnudeln, Olivenöl, Mangold, Lachsschinken', () => {
  assert.equal(check('Pizza Margherita', ['125 g Mozzarella', '3 EL Olivenöl', '1 Dose Tomaten, passiert']).blocked, false);
  assert.equal(check('Pasta', ['250 g Muschelnudeln', '1 Zwiebel']).blocked, false);
  assert.equal(check('Gemüsepfanne', ['300 g Mangold', '2 Möhren']).blocked, false);
  assert.equal(check('Nudeln', ['100 g Lachsschinken', '250 g Nudeln']).blocked, false);
});

test('rohe Tomaten/Zwiebeln: nur im Rohkontext gesperrt', () => {
  assert.equal(check('Nudelsauce', ['500 g Tomaten', '1 Zwiebel', '250 g Nudeln']).blocked, false);
  assert.equal(check('Tomatensalat', ['4 Tomaten', '1 EL Essig'], ['Salat']).blocked, true);
  assert.equal(check('Burger', ['2 Tomaten in Scheiben', '4 Brötchen']).blocked, true);
  assert.equal(check('Sandwich', ['1 rote Zwiebel', '2 Scheiben Brot']).blocked, true);
  assert.equal(check('Suppe', ['2 Zwiebeln', '1 l Brühe']).blocked, false);
  assert.equal(check('Pasta', ['1 EL Tomatenmark', '250 g Nudeln']).blocked, false);
});

test('Paprika: Pulver ok, große Stücke gesperrt', () => {
  assert.equal(check('Gulasch', ['2 TL Paprikapulver edelsüß', '500 g Rind']).blocked, false);
  assert.equal(check('Pfanne', ['1 rote Paprika, in Streifen geschnitten', '200 g Reis']).blocked, true);
  assert.equal(check('Gefüllte Paprika', ['4 Paprika', '300 g Hack']).blocked, true);
  assert.equal(check('Sauce', ['1 Paprika, fein gewürfelt', '1 Dose Tomaten']).blocked, false);
});
