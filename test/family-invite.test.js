const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('記録共有は一度限りの招待コードだけを発行・受諾する', () => {
  assert.match(html, /httpsCallable\('createFamilyInviteCode'\)/);
  assert.match(html, /httpsCallable\('acceptFamilyInviteCode'\)/);
  assert.match(html, /招待するひと：招待コードの発行/);
  assert.match(html, /招待されたひと：招待コードの入力/);
  assert.match(html, /コードをコピー/);
  assert.doesNotMatch(html, /httpsCallable\('inviteFamilyMember'\)/);
  assert.doesNotMatch(html, /id="familyEmailInput"|id="familyInviteUrl"/);
});

test('記録共有画面は説明・メンバー・人数・発行・入力の順に表示する', () => {
  const modal = html.slice(html.indexOf('id="familyModalBackdrop"'), html.indexOf('id="photoViewerBackdrop"'));
  const labels = [
    '他のひとをこの記録に招待しましょう',
    '現在の共有メンバー',
    'id="familySeatStatus"',
    '招待するひと：招待コードの発行',
    '招待されたひと：招待コードの入力',
  ];
  let previous = -1;
  for (const label of labels) {
    const current = modal.indexOf(label);
    assert.ok(current > previous, `「${label}」の表示順が正しくありません`);
    previous = current;
  }
  assert.match(html, /usage-guide\.html#s11/);
  assert.match(html, /記録を共有するためには、共有枠の購入が必要です/);
});

test('共有メンバーを削除する前に影響を説明して確認する', () => {
  assert.match(html, /との共有を解除しますか？解除すると、この記録を閲覧・編集できなくなります/);
  assert.match(html, /httpsCallable\('removeFamilyMember'\)/);
  assert.match(html, /httpsCallable\('undoScheduledMedication'\)/);
});

test('アカウントを切り替えて家族共有画面を開くと前の招待コードを消す', () => {
  const block = html.slice(html.indexOf('openFamilyModal(){'), html.indexOf('closeFamilyModal(){'));
  assert.match(block, /familyInviteCode'\)\.value = ''/);
  assert.match(block, /familyJoinCode'\)\.value = ''/);
});

test('招待コードの有効期限・一度限り・再発行時の失効を説明する', () => {
  assert.match(html, /招待コードは7日間有効/);
  assert.match(html, /1人が参加すると使用済み/);
  assert.match(html, /再発行すると、以前の未使用コードも使えなくなります/);
});

test('レポート作成中は犬と猫の作業イラストを表示する', () => {
  assert.match(html, /class="report-loading-pets"/);
  assert.match(html, /icons\/dog\.png/);
  assert.match(html, /icons\/report\.png/);
  assert.match(html, /icons\/cat\.png/);
  assert.doesNotMatch(html, /class="report-loading-spinner"/);
});

test('レポートは現UIの時刻つき記録を日付カードへ統合し、編集不能な旧食事項目は出さない', () => {
  const block = html.slice(html.indexOf('async printReport(){'), html.indexOf('async openCheckout'));
  assert.match(block, /毎日の記録/);
  assert.match(block, /eventsByDate/);
  assert.match(block, /eventTypeInfo\(event\.type\)\.icon|const info = eventTypeInfo\(event\.type\)/);
  assert.match(block, /printableEvents = dayEvents\.filter\(event => event\.type !== 'memo'\)/);
  assert.doesNotMatch(block, /event\.note \|\|/);
  assert.match(block, /登録しているごはん/);
  assert.match(block, /petMealProfiles\(\)/);
  assert.doesNotMatch(block, /pet\.dietMain|pet\.dietTopping|pet\.dietTreats/);
});

test('レポートのグラフとタイムライン表は現行スタイルのままページを跨がない', () => {
  const printCss = html.slice(html.indexOf('@media print'), html.indexOf('</style>'));
  const reportBlock = html.slice(html.indexOf('async printReport(){'), html.indexOf('async openCheckout'));
  assert.match(printCss, /\.report-keep-together[\s\S]*break-inside:avoid-page/);
  assert.match(printCss, /\.symptom-timeline-scroll[\s\S]*page-break-inside:avoid/);
  assert.match(reportBlock, /report-keep-together report-chart-block/);
  assert.match(reportBlock, /index === 0 \? '<h2[^']+>グラフ<\/h2>'/);
  // 日次サマリー・タイムラインは events からも日次値を拾うため merge 済みの dailyRecords を渡す。
  // 症状セクションは便・ごはん・体温からの自動判定症状を足した symptomRecords を渡す。
  assert.match(reportBlock, /buildDailyStatusTimelineHtml\(dailyRecords, \{ chunkSize: PRINT_TIMELINE_CHUNK_DAYS \}\)/);
  assert.match(reportBlock, /buildSymptomTimelineHtml\(symptomRecords, \{ chunkSize: PRINT_TIMELINE_CHUNK_DAYS \}\)/);
  assert.match(reportBlock, /const dailyRecords = mergeDailyRecordsWithEvents\(records, events, from, to\)/);
  assert.match(reportBlock, /const symptomRecords = dailyRecords\.map\(r => \(\{[\s\S]*?derivedSymptoms/);
  assert.match(reportBlock, /derivedSymptomNoteHtml\(dailyRecords\)/);
  // 注記の本文は共通ヘルパー derivedSymptomNoteHtml() 側にある
  assert.match(html, /function derivedSymptomNoteHtml\(recs\)[\s\S]*?便スコア\(6・7→下痢／4・5→軟便\)/);
});

test('グラフタブも events から日次値・自動判定症状を反映する（レポートと同じ経路）', () => {
  const drawCharts = html.slice(html.indexOf('drawCharts(){'), html.indexOf('renderDailyStatusTimeline(records){'));
  // 体重・食欲・日々の状態・症状の元データを merge 済みにする
  assert.match(drawCharts, /const records = this\.filterByRange\(mergeDailyRecordsWithEvents\(petRecords\(\), petEvents\(\), null, null\)\)/);
  // 症状セクションは自動判定症状を足した symptomRecords を使う
  assert.match(drawCharts, /const symptomRecords = records\.map\(r => \(\{[\s\S]*?derivedSymptoms/);
  assert.match(drawCharts, /this\.renderSymptomTimeline\(symptomRecords\)/);
  assert.match(drawCharts, /symptomRecords\.forEach\(r => safeArray\(r\.symptoms\)/);
  // 症状グラフの説明に自動判定の注記がある
  assert.match(html, /便スコア\(6・7→下痢／4・5→軟便\)、ごはんの食べた量\(50%以下→食欲不振\)、体温\(39\.5℃以上→発熱\)から自動判定した症状も集計に含みます。/);
});

test('レポートの日付カードは共通24時間軸で2日を比較し、4日ごとに改ページする', () => {
  const printCss = html.slice(html.indexOf('@media print'), html.indexOf('</style>'));
  const reportBlock = html.slice(html.indexOf('async printReport(){'), html.indexOf('async openCheckout'));
  assert.match(printCss, /\.report-pair-body\{display:grid;grid-template-columns:42px 1fr 1fr/);
  assert.match(printCss, /\.report-day-pair[\s\S]*break-inside:avoid-page/);
  assert.match(printCss, /\.report-timed-event[^}]*grid-template-columns:30px 15px minmax\(0,1fr\)/);
  assert.match(reportBlock, /Array\.from\(\{length:24\}/);
  assert.match(reportBlock, /index \+= 4/);
  // 記録行のテンプレートは eventRowHtml() に共通化。時刻→アイコン→要約の順を保つ。
  const eventTemplate = reportBlock.slice(reportBlock.indexOf('const eventRowHtml ='), reportBlock.indexOf('};', reportBlock.indexOf('const eventRowHtml =')));
  assert.ok(eventTemplate.indexOf('report-event-time') < eventTemplate.indexOf('${info.icon}'));
  assert.ok(eventTemplate.indexOf('${info.icon}') < eventTemplate.indexOf('report-event-text'));
  // 記録が多すぎる日は時刻配置をやめて詰めたリストに切り替える。
  assert.match(reportBlock, /n > DAY_LANE_DENSE_LIMIT/);
  assert.match(reportBlock, /report-day-lane--list/);
  assert.match(printCss, /\.report-list-event\{[^}]*grid-template-columns:30px 15px minmax\(0,1fr\)/);
});

test('実機確認で見つかった文言・メモ・猫の狂犬病選択を修正する', () => {
  assert.match(html, /'選択中の記録を編集する'/);
  assert.match(html, /eventNoteField'\)\.classList\.toggle\('hidden', actualType === 'memo'\)/);
  assert.match(html, /rabiesOption\.hidden = !dogSelected/);
  assert.match(html, /rabiesOption\.disabled = !dogSelected/);
});
