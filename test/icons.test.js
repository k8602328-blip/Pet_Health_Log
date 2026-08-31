'use strict';

// コンセプト忠実版アイコン（docs/design-concepts/ の正本7枚をトレースしたインラインSVGスプライト）
// の対応関係と、絵文字置換の方針を固定する回帰テスト。
// - 全34 symbol が存在し、viewBox は 0 0 32 32 で統一されている
// - 参照(use href / iconSvg / petTypeIcon)がすべて実在 symbol を指し、未使用 symbol も無い
// - 同じ意味は 1 symbol を再利用する（家族共有・アップグレード・くすり・くすり登録・写真添付 等）
// - スプライトが外部通信・スクリプト・ラスター・xlink を含まず、symbol 本体に日本語を埋め込まない
// - 置換対象の絵文字（🐾 📖 🐶 🐱 💊 📷 📝 🖨 🗑 👪）は本文から消えている
// - 意味を伝える警告記号（⚠️ ⏳ 🔔 🕒 ⏸ ▶ ● 📱 🏠 ✕）は意図して残している
// - アップグレード詳細（UPGRADE_ITEMS）と ペット選択（renderPetSelect）が SVG 化されている

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./load-app');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const app = loadApp();

// --- スプライト本体の切り出し ------------------------------------------------
const spriteOpen = HTML.indexOf('<svg', HTML.indexOf('data-role="icon-sprite"') - 200);
const spriteEnd = HTML.indexOf('</svg>', HTML.indexOf('data-role="icon-sprite"'));
assert.ok(spriteOpen > -1 && spriteEnd > spriteOpen, 'アイコンスプライトが見つからない');
const SPRITE = HTML.slice(spriteOpen, spriteEnd + '</svg>'.length);
// HTMLコメント（正本画像名の出典メモ）を除いた、実際に描画される中身
const SPRITE_BODY = SPRITE.replace(/<!--[\s\S]*?-->/g, '');

const symbolIds = [...SPRITE.matchAll(/<symbol id="(ic-[a-z-]+)"/g)].map((m) => m[1]);
const symbolIdSet = new Set(symbolIds);

function referencedIds() {
  const ids = new Set();
  for (const m of HTML.matchAll(/href="#(ic-[a-z-]+)"/g)) ids.add(m[1]);
  for (const m of HTML.matchAll(/\biconSvg\('([a-z-]+)'/g)) ids.add('ic-' + m[1]);
  for (const m of HTML.matchAll(/\bpetTypeIcon\('([a-z-]+)'/g)) ids.add('ic-' + m[1]);
  return ids;
}

const EXPECTED_SYMBOLS = [
  // 固定クイック記録12
  'ic-urine', 'ic-stool', 'ic-symptom', 'ic-weight', 'ic-treat', 'ic-meal', 'ic-water',
  'ic-walk', 'ic-play', 'ic-medication', 'ic-visit', 'ic-memo',
  // ペット種別・主要ナビ
  'ic-paw', 'ic-dog', 'ic-cat', 'ic-daily', 'ic-chart', 'ic-menu', 'ic-family', 'ic-upgrade',
  // メニュー固有
  'ic-meal-setup', 'ic-med-setup', 'ic-prevention', 'ic-visits', 'ic-report', 'ic-history',
  'ic-guide', 'ic-contact', 'ic-privacy', 'ic-logout', 'ic-account-delete',
  // アップグレード詳細の不足2 + レコード用ごみ箱
  'ic-lock', 'ic-camera', 'ic-trash',
];

const QUICK_EVENT_KEYS = ['urine', 'stool', 'walk', 'play', 'treat', 'meal', 'water', 'medication', 'weight', 'symptom', 'visit', 'memo'];
const MENU_ICON_IDS = [
  'ic-meal-setup', 'ic-med-setup', 'ic-prevention', 'ic-visits', 'ic-report', 'ic-history',
  'ic-family', 'ic-upgrade', 'ic-guide', 'ic-contact', 'ic-privacy', 'ic-logout', 'ic-account-delete',
];
// 意味を伝えるため、統一アイコンへ置換せず意図して残す記号（完了報告にも記載）
const KEPT_EMOJI = ['⚠️', '⏳', '🔔', '🕒', '⏸', '▶', '●', '📱', '🏠', '✕'];
// レコードカード等からも撤去する絵文字
const REMOVED_EMOJI = ['🐾', '📖', '🐶', '🐱', '💊', '📷', '📝', '🖨', '🗑', '👪', '⭐', '🍚', '☰', '🛡️', '🏥', '📄', '🗓️', '❔', '✉️', '🔒', '↪️'];

// --- テスト ---------------------------------------------------------------------

test('全34 symbol が存在し、viewBox は 0 0 32 32 で統一されている', () => {
  assert.deepEqual([...symbolIdSet].sort(), [...EXPECTED_SYMBOLS].sort());
  assert.equal(symbolIds.length, 34);
  const nonStandard = [...SPRITE.matchAll(/<symbol id="(ic-[a-z-]+)" viewBox="([^"]*)"/g)]
    .filter((m) => m[2] !== '0 0 32 32').map((m) => m[1]);
  assert.deepEqual(nonStandard, [], `viewBox が 0 0 32 32 でない: ${nonStandard.join(', ')}`);
});

test('iconSvg / petTypeIcon が <use> でスプライトを参照する装飾SVGを返す', () => {
  assert.equal(app.iconSvg('family'), '<svg class="ic" aria-hidden="true" focusable="false"><use href="#ic-family"/></svg>');
  assert.equal(app.iconSvg('trash', 'ic--danger inline-ic'),
    '<svg class="ic ic--danger inline-ic" aria-hidden="true" focusable="false"><use href="#ic-trash"/></svg>');
  assert.match(app.petTypeIcon('dog', '犬'), /class="ic pet-type-ic" role="img" aria-label="犬"><use href="#ic-dog"\/>/);
});

test('固定クイック記録12項目の EVENT_TYPES が対応する<symbol>を参照する', () => {
  assert.deepEqual(Object.keys(app.EVENT_TYPES).sort(), [...QUICK_EVENT_KEYS].sort());
  for (const key of QUICK_EVENT_KEYS) {
    assert.match(app.EVENT_TYPES[key].icon, new RegExp(`href="#ic-${key}"`), `${key} のアイコン参照が不正`);
    assert.ok(symbolIdSet.has(`ic-${key}`));
  }
  assert.match(app.eventTypeInfo('__unknown__').icon, /href="#ic-memo"/);
});

test('参照されるアイコンidはすべて実在する<symbol>（宙ぶらりんの参照が無い）', () => {
  const missing = [...referencedIds()].filter((id) => !symbolIdSet.has(id));
  assert.deepEqual(missing, [], `未定義アイコンを参照: ${missing.join(', ')}`);
});

test('未使用の<symbol>が無い（重複・死蔵素材を作らない）', () => {
  const refs = referencedIds();
  const unused = [...symbolIdSet].filter((id) => !refs.has(id));
  assert.deepEqual(unused, [], `参照されない<symbol>: ${unused.join(', ')}`);
});

test('同じ意味のアイコンは画面間で1つの<symbol>を再利用する', () => {
  for (const id of ['ic-family', 'ic-upgrade', 'ic-medication', 'ic-paw', 'ic-report', 'ic-camera', 'ic-guide']) {
    assert.equal((SPRITE.match(new RegExp(`<symbol id="${id}"`, 'g')) || []).length, 1, `${id} が重複定義されている`);
  }
  const header = HTML.slice(HTML.indexOf('<div class="pet-switch">'), HTML.indexOf('</header>'));
  assert.equal((header.match(/href="#ic-family"/g) || []).length, 2, 'ヘッダーの家族共有はフル/コンパクト2箇所');
  assert.equal((header.match(/href="#ic-upgrade"/g) || []).length, 2);
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  assert.match(menu, /iconSvg\('family'\)/);
  assert.match(menu, /iconSvg\('upgrade'\)/);
  // 予定投薬行・予定投薬ロック・レコードカードの投薬タグは くすり(EVENT_TYPES.medication) を再利用
  assert.match(HTML, /class="event-icon">\$\{eventTypeInfo\('medication'\)\.icon\}/);
  assert.match(HTML, /class="scheduled-lock">\$\{eventTypeInfo\('medication'\)\.icon\}/);
});

test('主要ナビ3タブ・ブランド肉球・ヘッダー使い方ガイドが対応SVGを参照する', () => {
  const nav = HTML.slice(HTML.indexOf('<nav class="tabs"'), HTML.indexOf('</nav>'));
  for (const id of ['ic-daily', 'ic-chart', 'ic-menu']) assert.match(nav, new RegExp(`href="#${id}"`));
  assert.equal((HTML.match(/<div class="brand"[^>]*><svg class="ic"[^>]*><use href="#ic-paw"\/>/g) || []).length, 2,
    'ログイン画面とヘッダーのブランド肉球が ic-paw になっていない');
  assert.match(HTML, /id="usageGuideButton"[^>]*><svg class="ic"[^>]*><use href="#ic-guide"\/>/);
});

test('メニュー全13項目が対応SVGを参照し、アカウント削除だけ ic--danger', () => {
  const menu = HTML.slice(HTML.indexOf('renderMenu(){'), HTML.indexOf('renderMealProfiles(){'));
  const used = [...menu.matchAll(/iconSvg\('([a-z-]+)'/g)].map((m) => 'ic-' + m[1]);
  assert.equal(used.length, 13, `メニュー項目のアイコン数が13でない: ${used.length}`);
  assert.deepEqual([...new Set(used)].sort(), [...MENU_ICON_IDS].sort());
  assert.match(menu, /iconSvg\('account-delete', ?'ic--danger'\)/);
});

test('ペット選択: option から絵文字を外し、種別SVGを select の外側へ出す', () => {
  const fn = HTML.slice(HTML.indexOf('renderPetSelect(){'), HTML.indexOf('selectPet(id){'));
  assert.doesNotMatch(fn, /[🐶🐱🐾]/, 'renderPetSelect にまだ絵文字が残っている');
  assert.match(fn, /option\.textContent = displayText\(p\.name\)/, 'option テキストがペット名のみになっていない');
  assert.match(fn, /petSwitchSpecies/, 'select 外側の種別アイコン枠を更新していない');
  assert.match(fn, /petTypeIcon\('dog','犬'\)/);
  assert.match(fn, /petTypeIcon\('cat','猫'\)/);
  assert.match(fn, /petTypeIcon\('paw','ペット'\)/);
  // マークアップ側に受け皿があり、ネイティブ select は維持されている
  assert.match(HTML, /<span class="pet-switch-species" id="petSwitchSpecies"[^>]*><\/span>\s*<select id="petSelect" onchange="App\.selectPet\(this\.value\)">/);
  // 「＋ペット追加」コンパクト表示は犬+猫SVG
  assert.match(HTML, /class="btn-label-compact">\+<svg class="ic"[^>]*><use href="#ic-dog"\/><\/svg><svg class="ic"[^>]*><use href="#ic-cat"\/>/);
});

test('アップグレード詳細（UPGRADE_ITEMS）の絵文字が統一SVGへ置換されている', () => {
  const block = HTML.slice(HTML.indexOf('const UPGRADE_ITEMS'), HTML.indexOf('renderUpgradeItems(){'));
  assert.doesNotMatch(block, /🐾|🔒|🖨|💊|📷|📊|📝/, 'UPGRADE_ITEMS にまだ絵文字が残っている');
  for (const id of ['paw', 'lock', 'report', 'medication', 'camera', 'chart', 'memo']) {
    assert.match(block, new RegExp(`iconSvg\\('${id}'\\)`), `UPGRADE_ITEMS が ${id} を使っていない`);
  }
  // 商品説明・価格・購入キーは不変
  assert.match(block, /item:'extraPet'[\s\S]*price:'¥150\(買い切り\)'/);
  assert.match(block, /item:'reportPack'[\s\S]*price:'¥300\(買い切り\)'/);
  assert.match(block, /item:'supportPlan'[\s\S]*price:'¥480\/月'/);
});

test('レコードカード・バナーの 💊 📷 📝 🗑 👪 が対応SVGへ置換されている', () => {
  // renderMenu 以降（アプリ本体のレンダリング）に置換対象の絵文字が残っていない
  const body = HTML.slice(HTML.indexOf('const App = {'));
  for (const e of ['💊', '📷', '📝', '🗑', '👪', '🖨']) {
    assert.ok(!body.includes(e), `アプリ本体に ${e} が残っている`);
  }
  assert.match(HTML, /class="memo-row"><td colspan="\$\{colCount\}">\$\{iconSvg\('memo'\)\}/);
  assert.match(HTML, /iconSvg\('trash'/); // 削除申請バナー / ペット削除ボタン
  assert.match(HTML, /addBanner\([^)]*'family'\)/); // 家族共有バナー
});

test('意図して残す警告・状態記号は本文に残っている（完了報告に列挙）', () => {
  for (const e of ['⚠️', '⏳', '🔔', '🕒', '📱', '🏠']) {
    assert.ok(HTML.includes(e), `残すはずの ${e} が消えている`);
  }
});

test('スプライトは外部通信・スクリプト・ラスター・xlink を含まず、symbol本体に日本語が無い', () => {
  assert.doesNotMatch(SPRITE, /<script/i);
  assert.doesNotMatch(SPRITE, /<image\b/i);
  assert.doesNotMatch(SPRITE, /xlink:href/i);
  assert.doesNotMatch(SPRITE, /href="https?:/i);
  assert.doesNotMatch(SPRITE, /data:image\//i);
  // 実際に描画される部分（HTMLコメントの出典メモは除外）に日本語ラベルを埋め込まない
  assert.doesNotMatch(SPRITE_BODY, /[぀-ヿ一-龯]/, 'symbol本体に日本語文字がある');
});

test('コンセプトのパステル塗り分けが保たれている（単色化への逆戻り防止）', () => {
  const icRule = HTML.slice(HTML.indexOf('.ic{'), HTML.indexOf('.ic{') + 900);
  assert.match(icRule, /--ic-ink:/);
  assert.match(icRule, /stroke:var\(--ic-ink\)/);
  assert.doesNotMatch(icRule, /stroke:currentColor/);
  assert.match(HTML, /\.ic--danger\{--ic-ink:/);
  for (const token of ['--ic-blue', '--ic-brown', '--ic-paw', '--ic-peach', '--ic-mint', '--ic-gold',
    '--ic-coral', '--ic-coral-deep', '--ic-turq', '--ic-lavender', '--ic-cream', '--ic-yellow', '--ic-tan']) {
    assert.match(SPRITE, new RegExp(`fill="var\\(${token}\\)"`), `${token} がどの<symbol>のfillにも使われていない`);
  }
  const filled = symbolIds.filter((id) => {
    const m = SPRITE.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`));
    return m && /fill="var\(--ic-(?!ink)/.test(m[0]);
  }).length;
  assert.ok(filled >= 28, `パステルfillを持つ<symbol>が少なすぎる: ${filled}`);
});
