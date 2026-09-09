'use strict';

// 旧 visits コレクションを廃止し、受診記録を events の type:'visit' へ一本化した回帰テスト。
// 公開Web版の index.html が旧 visits を購読・保存・削除しないこと、専用の受診歴タブと
// その導線を持たないこと、ホーム／レポートの受診表示が events 由来であることを保証する。
// deletePet の実挙動は deletePet.test.js で別途スタブ実行して検証する。
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('旧 visits コレクションへのアクセスがどこにも残っていない', () => {
  assert.doesNotMatch(HTML, /colRef\('visits'\)/);
  assert.doesNotMatch(HTML, /state\.visits/);
  assert.doesNotMatch(HTML, /editingVisitId/);
  assert.doesNotMatch(HTML, /getElementById\('visitForm'\)/);
  assert.doesNotMatch(HTML, /id="visitModalBackdrop"/);
  // Firestore リスナーの購読対象に visits を含めない。
  assert.match(HTML, /const collections = \['pets','records','medications','preventions','events','mealProfiles'\];/);
  assert.doesNotMatch(HTML, /detachFirestoreListeners[\s\S]*?visits:\s*\[\]/);
});

test('専用の受診歴タブとその導線を撤去した', () => {
  // レンダラ本体・タブ分岐・メニュー/ホームの switchTab 導線・専用CSSをすべて撤去。
  assert.doesNotMatch(HTML, /renderVisitsTab/);
  assert.doesNotMatch(HTML, /activeTab === 'visits'/);
  assert.doesNotMatch(HTML, /switchTab\('visits'\)/);
  assert.doesNotMatch(HTML, /\.visit-card\{/);
  assert.doesNotMatch(HTML, /\.visit-detail-/);
  // 健康管理メニューは「予防」だけになり、受診歴項目を持たない。
  const menu = HTML.slice(HTML.indexOf("group('健康管理'"), HTML.indexOf("group('健康管理'") + 160);
  assert.doesNotMatch(menu, /受診歴/);
  assert.doesNotMatch(menu, /iconSvg\('visits'\)/);
});

test('受診表示は events の type:\'visit\' から組み立てる', () => {
  const {buildVisitHistory}=require('./load-app').loadApp();
  const visits=buildVisitHistory([
    {type:'visit',date:'2026-09-08',details:{clinic:'A',diagnosis:'B'},note:'memo'},
    {type:'memo',date:'2026-09-09'},
    {type:'visit',date:'2026-09-07',details:{clinic:'old'}}
  ]);
  assert.equal(visits.length,2);
  assert.equal(visits[0].clinic,'A');
  assert.equal(visits[0].diagnosis,'B');
  assert.equal(visits[0].memo,'memo');
  assert.equal(visits[1].clinic,'old');
});

test('ホームの「直近の受診歴」カードは events 由来表示を残しつつタブ導線を持たない', () => {
  const home = HTML.slice(HTML.indexOf('renderHome(){'), HTML.indexOf('renderList(){'));
  assert.match(home, /直近の受診歴/);
  assert.match(home, /buildVisitHistory\(petEvents\(\)\)/);
  assert.match(home, /lastVisit\.diagnosis/);
  // 受診歴カードから旧タブへ飛ぶ「管理する」ボタンを撤去した。
  const visitCard = home.slice(home.indexOf('直近の受診歴') - 200, home.indexOf('直近の受診歴') + 400);
  assert.doesNotMatch(visitCard, /switchTab\('visits'\)/);
  assert.doesNotMatch(visitCard, /管理する/);
});

test('レポートは events 由来の受診歴表を出力し続ける', () => {
  const report = HTML.slice(HTML.indexOf('printReport(){'), HTML.indexOf("document.getElementById('printArea').innerHTML"));
  assert.match(report, /const visits = buildVisitHistory\(petEvents\(\)\);/);
  assert.match(report, /受診歴/);
});

test('受診記録の入力は「本日の記録」の「病院」クイック項目に一本化されている', () => {
  // クイック記録の固定項目に visit（ラベル「病院」）が含まれ、events フォームへ流れる。
  assert.match(HTML, /visit: \{ label:'病院', icon:iconSvg\('visit'\) \}/);
  assert.match(HTML, /App\.openEventModal\('\$\{type\}'\)/);
  // 受診記録専用の追加/編集/削除 UI は存在しない。
  assert.doesNotMatch(HTML, /openVisitModal/);
  assert.doesNotMatch(HTML, /受診記録を追加/);
});
