const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('家族共有画面で迷惑メール確認と招待リンクの代替手段を案内する', () => {
  assert.match(html, /迷惑メールフォルダも確認してください/);
  assert.match(html, /下の招待リンクを本人へ直接共有できます/);
});

test('招待メール送信成功後にも迷惑メール確認を案内する', () => {
  assert.match(html, /招待メールを送信しました。見つからない場合は迷惑メールフォルダを確認してください。/);
});

test('一度限りの招待コードを発行・受諾できる', () => {
  assert.match(html, /httpsCallable\('createFamilyInviteCode'\)/);
  assert.match(html, /httpsCallable\('acceptFamilyInviteCode'\)/);
  assert.match(html, /\?familyInvite=/);
  assert.match(html, /招待コードで参加/);
});
