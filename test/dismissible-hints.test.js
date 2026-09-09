'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadApp } = require('./load-app');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const HINT_IDS = ['medHintName', 'medHintDoses', 'medHintScheduled', 'medHintReminder', 'mealHintIntro'];

// classList を最小限模したフェイク要素。
function fakeEl() {
  const cls = new Set();
  return {
    classList: {
      toggle: (c, on) => { if (on === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else { on ? cls.add(c) : cls.delete(c); } },
      contains: c => cls.has(c),
      add: c => cls.add(c),
      remove: c => cls.delete(c),
    },
    has: c => cls.has(c),
  };
}

// 5説明 + それぞれの -restore、任意で追加要素を持つフェイク document。
function makeDoc(extraIds = [], presentHintIds = HINT_IDS) {
  const els = {};
  for (const id of presentHintIds) { els[id] = fakeEl(); els[id + '-restore'] = fakeEl(); }
  for (const id of extraIds) els[id] = fakeEl();
  return { els, document: { addEventListener() {}, getElementById: id => els[id] || null } };
}

function mapStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m,
  };
}

function withStorage(storage, fn) {
  const prev = global.localStorage;
  global.localStorage = storage;
  try { return fn(); } finally { global.localStorage = prev; }
}

// ── 初期表示・マークアップ ───────────────────────────────────────────────

test('5説明はそれぞれ固定IDと閉じる×・復元ボタンを持ち、初回は説明が表示される', () => {
  for (const id of HINT_IDS) {
    assert.match(html, new RegExp(`class="hint dismissible-hint" id="${id}">`), id);
    assert.match(html, new RegExp(`<button type="button" class="hint-dismiss" aria-label="この説明を閉じる" onclick="App\\.dismissHint\\('${id}'\\)">×</button>`), id);
    // 復元ボタンは初期状態で hidden、押すと showHint。
    assert.match(html, new RegExp(`<button type="button" class="hint-restore hidden" id="${id}-restore" onclick="App\\.showHint\\('${id}'\\)">説明を表示</button>`), id);
  }
});

test('.hint 全体は一括変更せず、目安時刻・課金案内・アップグレード誘導は対象外', () => {
  // 目安時刻(登録内容)はプレーンな .hint のまま。
  assert.match(html, /<div class="hint">目安時刻 \$\{escapeHtml\(profile\.suggestedTime\)\}<\/div>/);
  // 通知の購入誘導(upsell)は dismissible-hint 化していない。
  const upsellStart = html.indexOf('<div id="medReminderUpsell"');
  const upsellBlock = html.slice(upsellStart, html.indexOf('</div>', upsellStart) + 6);
  assert.match(upsellBlock, /<p class="hint">投薬リマインダー通知は/);
  assert.doesNotMatch(upsellBlock, /dismissible-hint/);
  // dismissible-hint は 5 箇所ちょうど。
  assert.equal((html.match(/class="hint dismissible-hint"/g) || []).length, 5);
});

test('×・復元ボタンはすべて type="button" でフォームを送信しない', () => {
  // 追加した hint-dismiss / hint-restore はすべて type="button"。
  for (const m of html.matchAll(/<button[^>]*class="hint-(?:dismiss|restore)[^"]*"[^>]*>/g)) {
    assert.match(m[0], /type="button"/, m[0]);
  }
  // submitMed 系の送信処理は呼ばない（DOM トグルのみ）。
  assert.doesNotMatch(html, /dismissHint\([^)]*\)\{[^}]*submit/);
});

// ── 個別の開閉・復元 ────────────────────────────────────────────────────

test('dismissHint は対象の説明だけを閉じ、restore を出す。他の説明は不変', () => {
  withStorage(mapStorage(), () => {
    const { els, document } = makeDoc();
    const { App } = loadApp({ document });
    App.applyHintVisibility();
    assert.equal(els.medHintName.has('hidden'), false);

    App.dismissHint('medHintName');
    assert.equal(els.medHintName.has('hidden'), true);
    assert.equal(els['medHintName-restore'].has('hidden'), false);
    // 他は触らない
    for (const id of HINT_IDS.filter(x => x !== 'medHintName')) {
      assert.equal(els[id].has('hidden'), false, id);
      assert.equal(els[id + '-restore'].has('hidden'), true, id);
    }

    App.showHint('medHintName');
    assert.equal(els.medHintName.has('hidden'), false);
    assert.equal(els['medHintName-restore'].has('hidden'), true);
  });
});

test('未知IDの dismissHint/showHint は無視する', () => {
  withStorage(mapStorage(), () => {
    const { document } = makeDoc();
    const { App, loadDismissedHints } = loadApp({ document });
    App.dismissHint('bogusHint');
    App.dismissHint('.hint');
    assert.deepEqual([...loadDismissedHints()], []);
  });
});

test('その画面に無い説明はスキップし、存在する説明だけ反映する', () => {
  withStorage(mapStorage({ 'mmk:dismissedHints': JSON.stringify(['medHintName', 'mealHintIntro']) }), () => {
    // お薬モーダルだけ存在（ごはん設定の要素は無い）
    const { els, document } = makeDoc([], ['medHintName', 'medHintDoses', 'medHintScheduled', 'medHintReminder']);
    const { App } = loadApp({ document });
    App.applyHintVisibility();
    assert.equal(els.medHintName.has('hidden'), true);
    assert.equal(els['medHintName-restore'].has('hidden'), false);
    assert.equal(els.medHintDoses.has('hidden'), false);
    // mealHintIntro は DOM に無いので getElementById→null、例外なくスキップ
  });
});

// ── 再描画・再読み込み後の保持 ─────────────────────────────────────────

test('閉じた状態は localStorage に保存され、再読み込み後も保持される', () => {
  const storage = mapStorage();
  withStorage(storage, () => {
    const first = loadApp({ document: makeDoc().document });
    first.App.dismissHint('medHintScheduled');
    first.App.dismissHint('mealHintIntro');
  });
  // 保存内容（端末内共通キー・配列）
  assert.deepEqual(JSON.parse(storage._map.get('mmk:dismissedHints')).sort(), ['mealHintIntro', 'medHintScheduled']);

  withStorage(storage, () => {
    const { els, document } = makeDoc();
    const { App } = loadApp({ document });
    App.applyHintVisibility();
    assert.equal(els.medHintScheduled.has('hidden'), true);
    assert.equal(els['medHintScheduled-restore'].has('hidden'), false);
    assert.equal(els.mealHintIntro.has('hidden'), true);
    assert.equal(els.medHintName.has('hidden'), false);
  });
});

test('再描画（applyHintVisibility 再呼び出し）でも保存状態を保つ', () => {
  withStorage(mapStorage(), () => {
    const { els, document } = makeDoc();
    const { App } = loadApp({ document });
    App.dismissHint('medHintDoses');
    App.applyHintVisibility();
    App.applyHintVisibility();
    assert.equal(els.medHintDoses.has('hidden'), true);
    assert.equal(els['medHintDoses-restore'].has('hidden'), false);
  });
});

// ── localStorage が使えない場合 ───────────────────────────────────────

test('localStorage 読み書き不可でも例外は出ず、セッション中の開閉は機能する', () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  withStorage(throwing, () => {
    const { els, document } = makeDoc();
    const { App } = loadApp({ document });
    assert.doesNotThrow(() => App.applyHintVisibility());
    assert.doesNotThrow(() => App.dismissHint('medHintReminder'));
    assert.equal(els.medHintReminder.has('hidden'), true);
    assert.equal(els['medHintReminder-restore'].has('hidden'), false);
    assert.doesNotThrow(() => App.showHint('medHintReminder'));
    assert.equal(els.medHintReminder.has('hidden'), false);
  });
});

test('localStorage 未定義でも動作する', () => {
  withStorage(undefined, () => {
    const { els, document } = makeDoc();
    const { App } = loadApp({ document });
    assert.doesNotThrow(() => App.dismissHint('medHintName'));
    assert.equal(els.medHintName.has('hidden'), true);
  });
});

// ── 通知欄の親を表示させない ───────────────────────────────────────────

test('通知の説明を復元しても、非表示の親欄(#medReminderField)は表示しない', () => {
  withStorage(mapStorage({ 'mmk:dismissedHints': JSON.stringify(['medHintReminder']) }), () => {
    const { els, document } = makeDoc(['medReminderField', 'medReminderUpsell']);
    // 未加入相当: 親欄は hidden
    els.medReminderField.classList.add('hidden');
    const { App } = loadApp({ document });
    App.applyHintVisibility();
    App.showHint('medHintReminder');
    // applyHintVisibility / showHint は親欄に触れない
    assert.equal(els.medReminderField.has('hidden'), true);
    assert.equal(els.medReminderUpsell.has('hidden'), false); // 触っていない
  });
});

// ── CSS（狭い画面で本文と×が重ならない・実機未確認） ──────────────────

test('CSS: dismissible-hint に×ぶんの右パディング、×は絶対配置', () => {
  assert.match(html, /\.dismissible-hint\{position:relative;padding-right:34px;\}/);
  assert.match(html, /\.hint-dismiss\{position:absolute;[^}]*\}/);
  assert.match(html, /\.hint-restore\{[^}]*\}/);
});
