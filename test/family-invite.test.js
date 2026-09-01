const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('家族共有は一度限りの招待コードだけを発行・受諾する', () => {
  assert.match(html, /httpsCallable\('createFamilyInviteCode'\)/);
  assert.match(html, /httpsCallable\('acceptFamilyInviteCode'\)/);
  assert.match(html, /招待コードで参加/);
  assert.match(html, /コードをコピー/);
  assert.doesNotMatch(html, /httpsCallable\('inviteFamilyMember'\)/);
  assert.doesNotMatch(html, /id="familyEmailInput"|id="familyInviteUrl"/);
});

test('招待コードの有効期限・一度限り・再発行時の失効を説明する', () => {
  assert.match(html, /招待コードは7日間有効/);
  assert.match(html, /1人が参加すると使用済み/);
  assert.match(html, /再発行すると、以前の未使用コードも使えなくなります/);
});
