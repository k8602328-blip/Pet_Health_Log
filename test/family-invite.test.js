const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('家族共有は一度限りの招待コードだけを発行・受諾する', () => {
  assert.match(html, /httpsCallable\('createFamilyInviteCode'\)/);
  assert.match(html, /httpsCallable\('acceptFamilyInviteCode'\)/);
  assert.match(html, /招待するひと：招待コードの発行/);
  assert.match(html, /招待されたひと：招待コードの入力/);
  assert.match(html, /コードをコピー/);
  assert.doesNotMatch(html, /httpsCallable\('inviteFamilyMember'\)/);
  assert.doesNotMatch(html, /id="familyEmailInput"|id="familyInviteUrl"/);
});

test('家族共有画面は説明・メンバー・人数・発行・入力の順に表示する', () => {
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
  assert.match(html, /usage-guide\.html#s10/);
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

test('レポートは現UIの時刻つき記録を出し、編集不能な旧食事項目は出さない', () => {
  const block = html.slice(html.indexOf('async printReport(){'), html.indexOf('async openCheckout'));
  assert.match(block, /時刻つき記録/);
  assert.match(block, /events\.map/);
  assert.match(block, /登録しているごはん/);
  assert.match(block, /petMealProfiles\(\)/);
  assert.doesNotMatch(block, /pet\.dietMain|pet\.dietTopping|pet\.dietTreats/);
});

test('実機確認で見つかった文言・メモ・猫の狂犬病選択を修正する', () => {
  assert.match(html, /'選択中の記録を編集する'/);
  assert.match(html, /eventNoteField'\)\.classList\.toggle\('hidden', actualType === 'memo'\)/);
  assert.match(html, /rabiesOption\.hidden = !dogSelected/);
  assert.match(html, /rabiesOption\.disabled = !dogSelected/);
});
