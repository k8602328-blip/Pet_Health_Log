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
});

test('招待コードの有効期限・一度限り・再発行時の失効を説明する', () => {
  assert.match(html, /招待コードは7日間有効/);
  assert.match(html, /1人が参加すると使用済み/);
  assert.match(html, /再発行すると、以前の未使用コードも使えなくなります/);
});
