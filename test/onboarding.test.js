'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('スマートフォンの導入画像はトリミングせず全体を表示する', () => {
  assert.match(html, /@media \(max-width:640px\)\{[\s\S]*?\.onboarding-imagewrap img\{object-fit:contain;\}/);
  assert.match(html, /\.onboarding-imagewrap\{[\s\S]*?padding:max\(54px, calc\(env\(safe-area-inset-top\) \+ 46px\)\)/);
});

test('導入文言は無料機能と治療サポートプラン対象を区別する', () => {
  assert.match(html, /治療サポートプランでは写真も添付できます/);
  assert.match(html, /体重の推移をグラフで確認できます/);
  assert.match(html, /PDFは毎月1回無料で、追加分はパックを購入して出力できます/);
  assert.doesNotMatch(html, /家族で健康管理に役立てるための記録アプリ/);
});
