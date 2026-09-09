'use strict';

// サンプルレポート（client/sample-report.pdf）とその再生成フィクスチャの回帰テスト。
// PDF 本体は client/tools/sample-report/generate.mjs で実物のレポート生成処理から作る。
// ここでは「成果物が壊れていないか」と「フィクスチャがレポート仕様の制約を満たすか」だけ見る。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

test('sample-report.pdf は A4 の複数ページ PDF として存在する', () => {
  const pdfPath = path.join(ROOT, 'sample-report.pdf');
  assert.ok(fs.existsSync(pdfPath), 'sample-report.pdf がない');
  const buf = fs.readFileSync(pdfPath);
  assert.equal(buf.toString('latin1', 0, 5), '%PDF-', 'PDF ヘッダがない');
  const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(pageCount >= 4, `ページ数が少なすぎる (${pageCount})`);
  // A4 = 595 x 842 pt。MediaBox にその寸法が入っていること。
  assert.match(buf.toString('latin1'), /MediaBox\s*\[\s*0\s+0\s+59[0-9](?:\.\d+)?\s+84[0-2](?:\.\d+)?\s*\]/, 'A4 の MediaBox が見当たらない');
});

test('再生成フィクスチャはレポート仕様の制約内に収まる', async () => {
  const fixture = (await import('../tools/sample-report/fixture.mjs')).default;
  const from = Date.parse(fixture.period.from);
  const to = Date.parse(fixture.period.to);
  const days = (to - from) / 86400000 + 1;
  // printReport の reportRangeError: 1〜31 日
  assert.ok(days >= 1 && days <= 31, `期間が 1〜31 日から外れている (${days})`);
  // 有料限定セクションも見本に含めるため加入済みにしている
  assert.equal(fixture.entitlements.subscriptionActive, true);
  assert.equal(fixture.pet.trackCibdai, true);
  // すべての記録・イベントが対象ペットのもので、期間内に少なくとも1件ある
  const inRange = (d) => d >= fixture.period.from && d <= fixture.period.to;
  assert.ok(fixture.records.some((r) => inRange(r.date)), '期間内のレガシー記録がない');
  assert.ok(fixture.events.some((e) => inRange(e.date)), '期間内のイベントがない');
  for (const r of fixture.records) assert.equal(r.petId, fixture.currentPetId);
  for (const e of fixture.events) assert.equal(e.petId, fixture.currentPetId);
  // 受診歴セクションの素になる visit イベントがある
  assert.ok(fixture.events.some((e) => e.type === 'visit'), 'visit イベントがない');
});
