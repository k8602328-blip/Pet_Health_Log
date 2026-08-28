'use strict';

// usage-guide.html はビルド不要の静的HTML。ここでは DOM を組み立てず、
// ファイル内容を文字列として検証する（既存の pure-functions.test.js と同じ方針で
// 外部依存を足さない）。主な確認は「新ページの存在」「10セクションの見出しと目次」
// 「既存ガイド/レポートへのリンク」「参照画像の実在」「アプリ内の常設導線」。

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT_DIR = path.join(__dirname, '..');
const guidePath = path.join(CLIENT_DIR, 'usage-guide.html');
const guideHtml = fs.readFileSync(guidePath, 'utf8');
const indexHtml = fs.readFileSync(path.join(CLIENT_DIR, 'index.html'), 'utf8');

test('usage-guide.html が存在し、title と h1 が仕様どおり', () => {
  assert.ok(fs.existsSync(guidePath));
  assert.match(guideHtml, /<title>どうぶつ健康手帳 使い方ガイド<\/title>/);
  assert.match(guideHtml, /<h1>どうぶつ健康手帳 使い方ガイド<\/h1>/);
  assert.match(guideHtml, /lang="ja"/);
});

test('10セクションのアンカー(#s1..#s10)と目次リンクが揃っている', () => {
  for (let i = 1; i <= 10; i += 1) {
    assert.ok(
      guideHtml.includes(`id="s${i}"`),
      `セクション id="s${i}" が無い`
    );
    assert.ok(
      guideHtml.includes(`href="#s${i}"`),
      `目次リンク href="#s${i}" が無い`
    );
  }
  // 目次は本文セクションの前に置く
  assert.ok(guideHtml.indexOf('href="#s1"') < guideHtml.indexOf('id="s1"'));
});

test('10セクションの見出し文言が含まれている', () => {
  const titles = [
    'どうぶつ健康手帳でできること',
    'ログインして、すぐ開けるようにする',
    'ペットを登録する',
    '毎日の様子を記録する',
    '記録を見返す・修正する',
    'お薬と投薬状況を管理する',
    '予防と受診の記録を残す',
    '記録の変化をグラフで見る',
    '記録を獣医師に共有する',
    '家族共有と投薬リマインダーを使う',
  ];
  for (const t of titles) {
    assert.ok(guideHtml.includes(t), `見出し「${t}」が無い`);
  }
});

test('折りたたみは <details> で、JS無効でも本文が読めるよう既定で open', () => {
  const detailsOpen = guideHtml.match(/<details class="sec"[^>]*\bopen\b/g) || [];
  assert.equal(detailsOpen.length, 10);
  // インラインの onclick / <script> は持たない（不要なJSを足さない方針）
  assert.ok(!/<script[\s>]/.test(guideHtml));
  assert.ok(!/ on[a-z]+=/.test(guideHtml));
});

test('アプリ・既存ガイド・レポートへのリンクがある', () => {
  assert.ok(guideHtml.includes('href="./"'), 'アプリへ戻るリンクが無い');
  // 先頭と末尾の2箇所
  assert.equal((guideHtml.match(/class="back[^"]*" href="\.\/"/g) || []).length, 2);
  assert.ok(guideHtml.includes('href="guide.html"'), 'guide.html へのリンクが無い');
  assert.ok(guideHtml.includes('href="pdf-guide.html"'), 'pdf-guide.html へのリンクが無い');
  assert.ok(guideHtml.includes('href="sample-report.pdf"'), 'sample-report.pdf へのリンクが無い');
});

test('参照している画像がすべて実在し、HEIC を参照していない', () => {
  const srcs = [...guideHtml.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 24, `画像参照が少なすぎる: ${srcs.length}`);
  for (const src of srcs) {
    assert.ok(!/\.hei[cf]$/i.test(src), `HEIC/HEIF を参照している: ${src}`);
    const abs = path.join(CLIENT_DIR, src);
    assert.ok(fs.existsSync(abs), `画像が見つからない: ${src}`);
  }
});

test('すべての img に alt と loading="lazy" が付いている', () => {
  const imgs = guideHtml.match(/<img[^>]*>/g) || [];
  assert.ok(imgs.length >= 24);
  for (const img of imgs) {
    assert.match(img, /\balt="[^"]+"/, `alt が無い: ${img}`);
    assert.match(img, /loading="lazy"/, `loading="lazy" が無い: ${img}`);
  }
});

test('採用しないと決めた重複画像を参照していない', () => {
  const forbidden = [
    'section08-02',
    'section10-04有料リマインダー2',
    'section10-04有料リマインダー3',
    'section10-03有料グラフ間隔変更',
    'med-reminder-sample',
  ];
  for (const f of forbidden) {
    assert.ok(!guideHtml.includes(f), `不使用のはずの画像を参照: ${f}`);
  }
});

test('有料機能を無料と誤認させない表記と、削除が元に戻せない旨がある', () => {
  assert.ok(guideHtml.includes('治療サポートプラン'));
  assert.ok(guideHtml.includes('月額480円'));
  assert.ok(guideHtml.includes('月額200円'));
  assert.ok(guideHtml.includes('無料枠は月1回'));
  assert.ok(guideHtml.includes('毎月1日に無料回数が復活します。無料回数は1以上には増えません。'));
  assert.ok(guideHtml.includes('元に戻せません') || guideHtml.includes('取り消せません'));
  // 診断を行うものではない旨
  assert.ok(guideHtml.includes('診断を行うものではありません'));
});

test('凡例のヒントと本文のヒント枠でクラスを共有しない', () => {
  assert.ok(guideHtml.includes('<span class="badge tip">ヒント</span>'));
  assert.ok(guideHtml.includes('<div class="tip-box">'));
  assert.ok(!guideHtml.includes('<div class="tip">'));
});

test('セクション1の不一致画像と重複する注意書きを掲載しない', () => {
  assert.ok(!guideHtml.includes('usage-guide-images/section01-01.png'));
  assert.equal((guideHtml.match(/診断を行うものではありません/g) || []).length, 1);
});

test('index.html に usage-guide.html を開く常設導線がある', () => {
  assert.ok(indexHtml.includes("window.open('usage-guide.html'"), 'usage-guide.html を開く導線が無い');
  assert.ok(indexHtml.includes('使い方ガイド'), '「使い方ガイド」ボタン文言が無い');
  assert.ok(indexHtml.includes('userBar.append(sessionRow, usageGuideButton)'), 'ガイドが独立した下段に追加されていない');
});

test('ユーザー操作とアカウント削除が視覚的に分離されている', () => {
  assert.ok(indexHtml.includes("sessionRow.append(userName, signOutButton)"));
  assert.ok(indexHtml.includes('id="accountFooter" class="account-footer hidden"'));
  assert.ok(indexHtml.includes('id="deleteAccountButton"'));
  assert.ok(indexHtml.includes("accountFooter.classList.remove('hidden')"));
  assert.ok(indexHtml.includes("document.getElementById('accountFooter').classList.add('hidden')"));
});
