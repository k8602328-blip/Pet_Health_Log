'use strict';

// 統一アイコン(絵文字→インラインSVGスプライト)の対応関係を固定する回帰テスト。
// - EVENT_TYPES・メニュー・ナビ・ペット種別が実在する<symbol>だけを参照している
// - 同じ意味のアイコン(家族共有・アップグレード・くすり)は1つの<symbol>を使い回している
// - スプライトが外部通信・スクリプト・ラスター画像・xlink参照を含まない
// - 合意済みのパステル配色(--ic-* + 各<symbol>のfill)が失われていない
// index.html はビルドの無い1枚ファイルなので、実行時exportと生テキストの両面で検証する。

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./load-app');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = loadApp();

// スプライト本体だけを切り出す
const spriteStart = HTML.indexOf('data-role="icon-sprite"');
const spriteEnd = HTML.indexOf('</svg>', spriteStart);
assert.ok(spriteStart > -1 && spriteEnd > spriteStart, 'アイコンスプライトが見つからない');
const SPRITE = HTML.slice(HTML.lastIndexOf('<svg', spriteStart), spriteEnd + '</svg>'.length);

const symbolIds = new Set([...SPRITE.matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]));

// index.html 全体でアイコンを参照している箇所（use href / iconSvg / petTypeIcon）
function referencedIds() {
  const ids = new Set();
  for (const m of HTML.matchAll(/href="#(ic-[a-z-]+)"/g)) ids.add(m[1]);
  for (const m of HTML.matchAll(/\biconSvg\('([a-z-]+)'/g)) ids.add('ic-' + m[1]);
  for (const m of HTML.matchAll(/\bpetTypeIcon\('([a-z-]+)'/g)) ids.add('ic-' + m[1]);
  return ids;
}

const QUICK_EVENT_KEYS = ['urine', 'stool', 'walk', 'play', 'treat', 'meal', 'water', 'medication', 'weight', 'symptom', 'visit', 'memo'];
const MENU_ICON_IDS = [
  'ic-meal-setup', 'ic-med-setup', 'ic-prevention', 'ic-visits', 'ic-report', 'ic-history',
  'ic-family', 'ic-upgrade', 'ic-guide', 'ic-contact', 'ic-privacy', 'ic-logout', 'ic-account-delete',
];

test('iconSvg / petTypeIcon が <use> でスプライトを参照する装飾SVGを返す', () => {
  assert.equal(app.iconSvg('family'), '<svg class="ic" aria-hidden="true" focusable="false"><use href="#ic-family"/></svg>');
  assert.equal(app.iconSvg('account-delete', 'ic--danger'),
    '<svg class="ic ic--danger" aria-hidden="true" focusable="false"><use href="#ic-account-delete"/></svg>');
  // ペット種別は可視ラベルが無いので代替テキストを持つ
  assert.match(app.petTypeIcon('dog', '犬'), /role="img" aria-label="犬"><use href="#ic-dog"\/>/);
});

test('固定クイック記録12項目の EVENT_TYPES が対応する<symbol>を参照する', () => {
  assert.deepEqual(Object.keys(app.EVENT_TYPES).sort(), [...QUICK_EVENT_KEYS].sort());
  for (const key of QUICK_EVENT_KEYS) {
    assert.match(app.EVENT_TYPES[key].icon, new RegExp(`href="#ic-${key}"`), `${key} のアイコン参照が不正`);
    assert.ok(symbolIds.has(`ic-${key}`), `ic-${key} の<symbol>が無い`);
  }
});

test('未知の種別は memo アイコンにフォールバックする', () => {
  assert.match(app.eventTypeInfo('__unknown__').icon, /href="#ic-memo"/);
});

test('参照されるアイコンidはすべて実在する<symbol>（宙ぶらりんの参照が無い）', () => {
  const missing = [...referencedIds()].filter((id) => !symbolIds.has(id));
  assert.deepEqual(missing, [], `未定義アイコンを参照: ${missing.join(', ')}`);
});

test('未使用の<symbol>が無い（重複・死蔵素材を作らない）', () => {
  const refs = referencedIds();
  const unused = [...symbolIds].filter((id) => !refs.has(id));
  assert.deepEqual(unused, [], `参照されない<symbol>: ${unused.join(', ')}`);
});

test('同じ意味のアイコンは画面間で1つの<symbol>を再利用する', () => {
  // 家族共有: トップヘッダー(フル+コンパクト)とメニューで同一
  assert.equal((SPRITE.match(/<symbol id="ic-family"/g) || []).length, 1, 'ic-family が重複定義');
  assert.equal((SPRITE.match(/<symbol id="ic-upgrade"/g) || []).length, 1, 'ic-upgrade が重複定義');
  const header = HTML.slice(HTML.indexOf('<div class="pet-switch">'), HTML.indexOf('</header>'));
  assert.equal((header.match(/href="#ic-family"/g) || []).length, 2, 'ヘッダーの家族共有アイコンはフル/コンパクト2箇所');
  assert.equal((header.match(/href="#ic-upgrade"/g) || []).length, 2);
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  assert.match(menu, /iconSvg\('family'\)/, 'メニューの家族共有が共有symbolを使っていない');
  assert.match(menu, /iconSvg\('upgrade'\)/);
  // 予定投薬行・予定投薬ロックは くすり(EVENT_TYPES.medication) を再利用
  assert.match(HTML, /class="event-icon">\$\{eventTypeInfo\('medication'\)\.icon\}/);
  assert.match(HTML, /class="scheduled-lock">\$\{eventTypeInfo\('medication'\)\.icon\}/);
});

test('主要ナビ3タブが対応SVGを参照する', () => {
  const nav = HTML.slice(HTML.indexOf('<nav class="tabs"'), HTML.indexOf('</nav>'));
  for (const id of ['ic-daily', 'ic-chart', 'ic-menu']) {
    assert.match(nav, new RegExp(`href="#${id}"`), `ナビに ${id} が無い`);
  }
});

test('メニュー全13項目が対応SVGを参照する', () => {
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  const used = [...menu.matchAll(/iconSvg\('([a-z-]+)'/g)].map((m) => 'ic-' + m[1]);
  assert.equal(used.length, 13, `メニュー項目のアイコン数が13でない: ${used.length}`);
  assert.deepEqual([...new Set(used)].sort(), [...MENU_ICON_IDS].sort());
  // アカウント削除だけは控えめなコーラル系
  assert.match(menu, /iconSvg\('account-delete', ?'ic--danger'\)/);
});

test('ペット名横の種別は犬・猫・汎用の3SVGを使い分ける', () => {
  const home = HTML.slice(HTML.indexOf('renderHome(){'), HTML.indexOf('renderHome(){') + 4000);
  assert.match(home, /petTypeIcon\('dog','犬'\)/);
  assert.match(home, /petTypeIcon\('cat','猫'\)/);
  assert.match(home, /petTypeIcon\('paw','ペット'\)/);
});

test('スプライトは外部通信・スクリプト・ラスター画像・xlink参照を含まない', () => {
  assert.doesNotMatch(SPRITE, /<script/i);
  assert.doesNotMatch(SPRITE, /<image\b/i);
  assert.doesNotMatch(SPRITE, /xlink:href/i);
  assert.doesNotMatch(SPRITE, /href="https?:/i);
  assert.doesNotMatch(SPRITE, /url\(https?:/i);
  assert.doesNotMatch(SPRITE, /data:image\//i);
});

test('SVGに日本語ラベルを埋め込まない（意味は隣のHTMLラベルが担う）', () => {
  assert.doesNotMatch(SPRITE, /[぀-ヿ一-龯]/, 'スプライト内に日本語文字がある');
});

test('合意済みのパステル配色が保たれている（単色化への逆戻り防止）', () => {
  // .ic はパレット変数を定義し、アウトラインは currentColor ではなく --ic-ink
  const icRule = HTML.slice(HTML.indexOf('.ic{'), HTML.indexOf('.ic{') + 600);
  assert.match(icRule, /--ic-ink:/);
  assert.match(icRule, /--ic-coral:/);
  assert.match(icRule, /stroke:var\(--ic-ink\)/);
  assert.doesNotMatch(icRule, /stroke:currentColor/);
  assert.match(HTML, /\.ic--danger\{--ic-ink:/);
  // 各コンセプト色が実際に<symbol>のfillとして使われている
  for (const token of ['--ic-blue', '--ic-brown', '--ic-peach', '--ic-mint', '--ic-gold', '--ic-coral', '--ic-turq', '--ic-lavender', '--ic-yellow', '--ic-cream', '--ic-tan']) {
    assert.match(SPRITE, new RegExp(`fill="var\\(${token}\\)"`), `${token} がどの<symbol>のfillにも使われていない`);
  }
  // 面のあるアイコンは少なくとも20個がパステルfillを持つ
  const filled = [...SPRITE.matchAll(/<symbol id="(ic-[a-z-]+)"[\s\S]*?<\/symbol>/g)]
    .filter((m) => /fill="var\(--ic-(?!ink)/.test(m[0])).length;
  assert.ok(filled >= 20, `パステルfillを持つ<symbol>が少なすぎる: ${filled}`);
});
