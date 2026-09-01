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
  'urine','stool','symptom','weight','temperature','treat','meal','water','walk','play','medication','visit','memo',
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

test('正本から切り出したPNG素材が揃っている', () => {
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

test('全PNG素材がindex.htmlから参照され、参照切れがない', () => {
  const refs = new Set(referencedPngs());
  for (const id of EXPECTED) assert.ok(refs.has(id), `${id}.png is not referenced`);
  for (const id of refs) assert.ok(EXPECTED.includes(id), `unexpected icon reference: ${id}`);
});

test('固定クイック記録13項目が指定順で対応PNGを使う', () => {
  const keys = ['meal','water','treat','urine','stool','walk','play','medication','weight','temperature','symptom','visit','memo'];
  assert.deepEqual(Object.keys(app.EVENT_TYPES), keys);
  for (const key of keys) assert.match(app.EVENT_TYPES[key].icon, new RegExp(`icons/${key}\\.png`));
});

test('体温グラフは治療サポートプラン対象として実装されている', () => {
  const graph = HTML.slice(HTML.indexOf('renderChartTab(){'), HTML.indexOf('renderExportTab(){'));
  assert.match(graph, /\['temperature','体温'\]/);
  assert.match(graph, /premiumGraphs = \['temperature'/);
  assert.match(graph, /event\.type === 'temperature'/);
  assert.match(graph, /temperatureChartCanvas/);
});

test('家族共有はトップから外し、メニューで統一素材を使う', () => {
  const header = HTML.slice(HTML.indexOf('<header class="topbar">'), HTML.indexOf('</header>'));
  assert.doesNotMatch(header, /family\.png|openFamilyModal/);
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  assert.match(menu, /iconSvg\('family'\)/);
});

test('メニューから選択中のペットを既存の安全な削除処理へ渡せる', () => {
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  assert.match(menu, /'選択中のペットを削除'/);
  assert.match(menu, /App\.deletePet\(state\.currentPetId\)/);
  assert.match(menu, /iconSvg\('trash','ic--danger'\)/);
});

test('ペット登録・編集で性別と敬称を保存でき、記録見出しを更新する', () => {
  for (const id of ['petGender','petHonorific','currentPetDisplayName','petEditId']) {
    assert.match(HTML, new RegExp(`id="${id}"`));
  }
  assert.match(HTML, /openPetEditModal\(\)/);
  assert.match(HTML, /gender: document\.getElementById\('petGender'\)\.value/);
  assert.match(HTML, /honorific: document\.getElementById\('petHonorific'\)\.value/);
  assert.equal(app.petDisplayName({ name:'もふ', honorific:'chan' }), 'もふちゃん');
  assert.equal(app.petDisplayName({ name:'もふ', honorific:'kun' }), 'もふくん');
  assert.equal(app.petDisplayName({ name:'もふ' }), 'もふ');
  assert.match(HTML, /petDisplayName\(current\)\)\}の記録/);
});

test('記録切り替えは名前を持たないトップボタンから開き、主要3タブを横一列に保つ', () => {
  assert.match(HTML, /id="switchRecordButton"[^>]*>記録を切り替える</);
  assert.match(HTML, /id="petSwitchModalBackdrop"/);
  assert.doesNotMatch(HTML, /id="petSelect"/);
  assert.match(HTML, /nav\.tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('追加・共有・課金・アカウント・ログアウトはメニューに置く', () => {
  const header = HTML.slice(HTML.indexOf('<header class="topbar">'), HTML.indexOf('</header>'));
  assert.doesNotMatch(header, /openPetModal|openFamilyModal|openUpgradeModal|ログアウト|userBar/);
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  for (const value of ['新しく登録する','openFamilyModal','openUpgradeModal','accountName','ログアウト']) assert.ok(menu.includes(value), value);
});

test('記録詳細は右上に閉じる、右下に編集・削除の順で表示する', () => {
  const detail = HTML.slice(HTML.indexOf('id="eventDetailBackdrop"'), HTML.indexOf('id="petModalBackdrop"'));
  assert.match(detail, /event-detail-close[^>]*>閉じる</);
  assert.match(detail, /event-detail-actions[^]*id="eventEditButton"[^]*>編集<\/button>[^]*id="eventDeleteButton"[^]*>削除<\/button>/);
  assert.doesNotMatch(detail, />削除する<\/button>/);
  assert.match(HTML, /\.event-detail-close\{position:absolute;top:12px;right:12px/);
  assert.match(HTML, /\.event-detail-actions\{display:flex;justify-content:flex-end/);
});

test('固定記録バーはトップレベル専用領域に描画し、実測高ぶん最終行を空ける', () => {
  assert.match(HTML, /<\/div>\s*<div id="quickDockHost"><\/div>\s*<div id="petSwitchModalBackdrop"/);
  const daily = HTML.slice(HTML.indexOf('renderDaily(){'), HTML.indexOf('eventFieldsHtml(type'));
  assert.match(daily, /document\.getElementById\('quickDockHost'\)\.innerHTML/);
  assert.match(daily, /getBoundingClientRect\(\)\.height\) \+ 20/);
  assert.match(daily, /new ResizeObserver\(update\)/);
  assert.match(HTML, /\.daily-screen\{padding-bottom:var\(--quick-dock-space,132px\)/);
  assert.match(HTML, /transform:translate3d\(0,0,0\);will-change:transform/);
});

test('入力モーダルを閉じるとフォーカスを解除して固定バーを再計測する', () => {
  assert.match(HTML, /restoreQuickDockAfterInput\(\)[^]*active\.blur\(\)[^]*setTimeout\(\(\) => this\.syncQuickDockSpacing\(\), 300\)/);
  for (const method of ['closeRecordModal','closeMedModal','closeEventModal']) {
    const start = HTML.indexOf(`${method}(){`);
    assert.ok(start >= 0, method);
    assert.match(HTML.slice(start, start + 350), /this\.restoreQuickDockAfterInput\(\)/);
  }
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
