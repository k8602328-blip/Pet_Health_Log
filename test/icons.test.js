'use strict';

// 正本コンセプトシートから直接切り出したPNGアイコンの回帰テスト。
// SVGによる再描画へ戻さず、全参照が実在する透過PNGを使うことを保証する。
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./load-app');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = loadApp();
const EXPECTED = [
  'urine','stool','symptom','weight','treat','meal','water','walk','play','medication','visit','memo',
  'paw','dog','cat','daily','chart','menu','family','upgrade','meal-setup','med-setup','prevention',
  'visits','report','history','guide','contact','privacy','logout','account-delete','lock','camera','trash',
];

function pngInfo(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', `${file} is not PNG`);
  return { width:b.readUInt32BE(16), height:b.readUInt32BE(20), colorType:b[25] };
}

function referencedPngs() {
  const ids = [...HTML.matchAll(/(?:src=\\?"|src=\\?')icons\/([a-z-]+)\.png/g)].map(m => m[1]);
  for (const m of HTML.matchAll(/\b(?:iconSvg|petTypeIcon)\('([a-z-]+)'/g)) ids.push(m[1]);
  return ids;
}

test('正本から切り出した34個のPNG素材が揃っている', () => {
  const actual = fs.readdirSync(path.join(ROOT, 'icons')).filter(f => f.endsWith('.png')).map(f => f.slice(0,-4));
  assert.deepEqual(actual.sort(), [...EXPECTED].sort());
});

test('全素材が透過対応PNGで、実用解像度を持つ', () => {
  for (const id of EXPECTED) {
    const info = pngInfo(path.join(ROOT, 'icons', `${id}.png`));
    assert.ok(info.width >= 75 && info.height >= 120, `${id}: ${info.width}x${info.height}`);
    assert.equal(info.colorType, 6, `${id} is not RGBA PNG`);
  }
});

test('iconSvgとpetTypeIconはSVGを描かずPNGを参照する', () => {
  assert.equal(app.iconSvg('family'), '<img class="ic" src="icons/family.png" alt="">');
  assert.equal(app.iconSvg('trash', 'ic--danger inline-ic'), '<img class="ic ic--danger inline-ic" src="icons/trash.png" alt="">');
  assert.equal(app.petTypeIcon('dog', '犬'), '<img class="ic pet-type-ic" src="icons/dog.png" alt="犬">');
});

test('全34素材がindex.htmlから参照され、参照切れがない', () => {
  const refs = new Set(referencedPngs());
  for (const id of EXPECTED) assert.ok(refs.has(id), `${id}.png is not referenced`);
  for (const id of refs) assert.ok(EXPECTED.includes(id), `unexpected icon reference: ${id}`);
});

test('固定クイック記録12項目が対応PNGを使う', () => {
  const keys = ['urine','stool','walk','play','treat','meal','water','medication','weight','symptom','visit','memo'];
  assert.deepEqual(Object.keys(app.EVENT_TYPES).sort(), [...keys].sort());
  for (const key of keys) assert.match(app.EVENT_TYPES[key].icon, new RegExp(`icons/${key}\\.png`));
});

test('家族共有はトップとメニューで同じ素材を使う', () => {
  assert.ok((HTML.match(/icons\/family\.png/g) || []).length >= 2);
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  assert.match(menu, /iconSvg\('family'\)/);
});

test('メニューから選択中のペットを既存の安全な削除処理へ渡せる', () => {
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  assert.match(menu, /'選択中のペットを削除'/);
  assert.match(menu, /App\.deletePet\(state\.currentPetId\)/);
  assert.match(menu, /iconSvg\('trash','ic--danger'\)/);
});

test('主要ナビ・ブランド・使い方ガイドがPNGを参照する', () => {
  for (const id of ['daily','chart','menu','paw','guide']) assert.match(HTML, new RegExp(`icons/${id}\\.png`));
});

test('アップグレード詳細は統一PNGを参照する', () => {
  const block = HTML.slice(HTML.indexOf('const UPGRADE_ITEMS'), HTML.indexOf('renderUpgradeItems(){'));
  for (const id of ['paw','lock','report','medication','camera','chart','memo']) assert.match(block, new RegExp(`iconSvg\\('${id}'\\)`));
  assert.doesNotMatch(block, /🐾|🔒|🖨|💊|📷|📊|📝/);
});

test('実表示用コードにSVG use参照を追加しない', () => {
  const runtime = HTML.slice(HTML.indexOf('</svg>', HTML.indexOf('data-role="icon-sprite"')) + 6);
  assert.doesNotMatch(runtime, /<use href="#ic-/);
});

test('置換対象の絵文字をアプリ本体へ戻さない', () => {
  const body = HTML.slice(HTML.indexOf('const App = {'));
  for (const e of ['💊','📷','📝','🗑','👪','🖨']) assert.ok(!body.includes(e), `${e} remains`);
});
