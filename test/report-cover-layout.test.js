'use strict';

// PDFレポートの構成変更（表紙の分離／4日ごとの記録ページ／カード単位の改ページ）の回帰テスト。
// 実際の改ページ結果は tools/sample-report/generate.mjs が生成する PDF を目視確認する。
// ここでは index.html 側の印刷CSSと printReport() の組み立てが仕様どおりかだけを見る。

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const printCss = html.slice(html.indexOf('@media print'), html.indexOf('</style>'));
const reportBlock = html.slice(html.indexOf('async printReport(){'), html.indexOf('async openCheckout'));

test('1ページ目は表紙: ロゴ＋アプリ名＋レポート名＋ペット情報・対象期間・作成日、記録は載せない', () => {
  // 表紙HTMLは records より先に組み立て、テンプレートは 表紙 → 毎日の記録 → 資料 の順。
  assert.match(reportBlock, /const coverHtml = `[\s\S]*?class="report-cover"/);
  // 表紙ロゴは native の AppIcon と同一データを配信用にコピーした app-icon-final.png。
  // 装飾用の icons/paw.png は表紙ロゴには使わない。
  assert.match(reportBlock, /class="report-cover-logo" src="icons\/app-icon-final\.png"/);
  assert.doesNotMatch(reportBlock, /report-cover-logo" src="icons\/paw\.png"/);
  assert.match(reportBlock, /class="report-cover-app">もふもふカルテ</);
  assert.match(reportBlock, /class="report-cover-title">体調記録レポート</);
  assert.match(reportBlock, /<dl class="report-cover-info">[\s\S]*?<dt>ペット<\/dt>[\s\S]*?<dt>対象期間<\/dt>[\s\S]*?<dt>作成日<\/dt>/);
  // 表紙セクション内に日々の記録テンプレートを混ぜない
  const coverChunk = reportBlock.slice(reportBlock.indexOf('const coverHtml'), reportBlock.indexOf('const resourcesInner'));
  assert.doesNotMatch(coverChunk, /report-record-page|report-day-pair|dailyCardsHtml/);
  // 出力テンプレートの並び
  assert.match(reportBlock, /innerHTML = `\s*\$\{coverHtml\}\s*\$\{dailyCardsHtml\}\s*\$\{resourcesHtml\}\s*`/);
});

test('配信用の表紙ロゴは native の AppIcon-512@2x.png と同一データ', () => {
  const delivered = path.join(__dirname, '..', 'icons', 'app-icon-final.png');
  assert.ok(fs.existsSync(delivered), 'client/icons/app-icon-final.png がない');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(delivered)).digest('hex');
  assert.equal(sha256, '46413a0bec5c821988c35c3f803af7a52179a2f553aa3a91dba90a9f9e89fd8c',
    'app-icon-final.png が AppIcon-512@2x.png と一致しない（切り抜き・再生成は禁止）');
  const nativeSrc = path.join(__dirname, '..', '..', 'native', 'ios', 'App', 'App',
    'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png');
  if (fs.existsSync(nativeSrc)) {
    const nativeSha = crypto.createHash('sha256').update(fs.readFileSync(nativeSrc)).digest('hex');
    assert.equal(sha256, nativeSha, '配信用コピーが native の元データと一致しない');
  }
});

test('表紙は vh に依存せず、内容の塊として直後で改ページする（iOSで下端に記録が流れ込まない）', () => {
  // 旧: min-height:calc(100vh - 24px)。iOSでは 100vh が用紙高さにならず表紙下端に
  // 「毎日の記録」が流れ込んでいた。vh を使わず break-inside:avoid + break-after:page にする。
  assert.doesNotMatch(printCss, /\.report-cover\{[\s\S]*?vh/);
  assert.match(printCss, /\.report-cover\{[\s\S]*?break-inside:avoid-page;page-break-inside:avoid/);
  assert.match(printCss, /\.report-cover\{[\s\S]*?break-after:page;page-break-after:always/);
  // 用紙・余白を @page で明示（デスクトップ印刷とサンプル生成用。iOS は Swift 側の余白）
  assert.match(printCss, /@page\{ size:A4; margin:12mm; \}/);
});

test('毎日の記録: 見出しは最初のブロック内に1回だけ、ブロックごと avoid で見出し＋4日を同ページに', () => {
  // ブロック全体を break-inside:avoid（iOSは @page 改ページを無視するのでこれで4日/ページにする）
  assert.match(printCss, /\.report-record-page\{break-inside:avoid-page;page-break-inside:avoid;\}/);
  assert.match(printCss, /\.report-record-page \+ \.report-record-page\{break-before:page;page-break-before:always;\}/);
  assert.doesNotMatch(printCss, /\.report-record-page\{break-after:page/);
  assert.doesNotMatch(printCss, /report-visit-page/);
  // 見出しは per-page の帯(report-record-head)をやめ、最初のブロックにだけ h2 を入れる
  assert.doesNotMatch(printCss, /report-record-head/);
  assert.doesNotMatch(reportBlock, /report-record-head/);
  assert.match(printCss, /\.report-record-title\{font-size:15px;/);
  assert.match(reportBlock, /const heading = index === 0 \? '<h2 class="report-record-title">毎日の記録<\/h2>' : '';/);
  assert.match(reportBlock, /class="report-record-page">\$\{heading\}\$\{rows\.map\(pairHtml\)\.join\(''\)\}/);
  // 記録ブロックは「見出し＋最大2枠」。空スライスの枠は作らない。
  assert.match(reportBlock, /rows = \[exportDates\.slice\(index, index \+ 2\)\]/);
  assert.match(reportBlock, /if\(index \+ 2 < exportDates\.length\) rows\.push\(exportDates\.slice\(index \+ 2, index \+ 4\)\)/);
});

test('記録枠の高さは固定px撤回。DAY_LANE_HEIGHT_PX 1点から算出し要素へ inline 指定', () => {
  // 旧 480/410px の固定は CSS から撤去（iOS印刷領域に合わせて JS 側で決める）
  assert.doesNotMatch(printCss, /\.report-day-pair\{[^}]*height:\d+px/);
  assert.doesNotMatch(printCss, /\.report-pair-body\{[^}]*[^-]height:\d+px/);
  assert.match(printCss, /\.report-pair-body\{display:grid;grid-template-columns:42px 1fr 1fr;overflow:hidden;\}/);
  // 枠1組の高さ = レーン高さ + 日付ヘッダ + サマリー + 枠線(PAIR_CHROME_PX)
  assert.match(reportBlock, /const DAY_PAIR_HEIGHT_PX = DAY_LANE_HEIGHT_PX \+ PAIR_CHROME_PX;/);
  // pairHtml が両方の高さを inline で渡す
  assert.match(reportBlock, /class="report-day-pair" style="height:\$\{DAY_PAIR_HEIGHT_PX\}px;">/);
  assert.match(reportBlock, /class="report-pair-body" style="height:\$\{DAY_LANE_HEIGHT_PX\}px;">/);
});

test('枠高さは印刷可能高さから表題・余白・段間隔を引いて上下等分で算出する', () => {
  // 印刷可能高さ(iOS側に合わせた見積り) — ここが唯一の調整点
  assert.match(reportBlock, /const PRINT_PAGE_CONTENT_PX = \(297 - 12 \* 2\) \* 96 \/ 25\.4;/);
  assert.match(reportBlock, /const RECORD_PAGE_SAFETY_PX = \d+;/);
  assert.match(reportBlock, /const RECORD_TITLE_PX = \d+;/);
  assert.match(reportBlock, /const PAIR_GAP_PX = 12;/);
  assert.match(reportBlock, /const PAIR_CHROME_PX = 28 \+ 39 \+ 2;/);
  // (印刷可能高さ − 表題 − 安全余白 − 段間隔) / 2 − 枠の造作 = レーン高さ
  assert.match(reportBlock, /const DAY_LANE_HEIGHT_PX = Math\.floor\(\s*\(PRINT_PAGE_CONTENT_PX - RECORD_TITLE_PX - RECORD_PAGE_SAFETY_PX - PAIR_GAP_PX\) \/ 2 - PAIR_CHROME_PX\s*\);/);
  // 285px の固定値はもう無い（算出に置き換えた）
  assert.doesNotMatch(reportBlock, /const DAY_LANE_HEIGHT_PX = \d+;/);
});

test('レーンの件数・行数・重なり回避しきい値は枠高さ(DAY_LANE_HEIGHT_PX)に追従して比例で再計算する', () => {
  assert.match(reportBlock, /const PREV_LANE_HEIGHT_PX = 330;/);
  // 時刻配置の上限は旧 330px 基準の 22件 を新しい高さへ比例
  assert.match(reportBlock, /DAY_LANE_DENSE_LIMIT = Math\.round\(DAY_LANE_HEIGHT_PX \/ \(PREV_LANE_HEIGHT_PX \/ 22\)\)/);
  // 詰めリストの行数は実行高(LIST_ROW_PX)から「レーン内に確実に収まる行数」を出す
  assert.match(reportBlock, /const LIST_ROW_PX = 12;/);
  assert.match(reportBlock, /DAY_LANE_LIST_MAX_ROWS = Math\.max\(6, Math\.floor\(\(DAY_LANE_HEIGHT_PX - 6 - LIST_ROW_PX\) \/ LIST_ROW_PX\)\)/);
  // body/レーンは指定高さで必ずクリップ（過密日のリストが隣枠に重ならない）
  assert.match(printCss, /\.report-pair-body\{display:grid;grid-template-columns:42px 1fr 1fr;overflow:hidden;\}/);
  assert.match(printCss, /\.report-day-lane\{[^}]*min-height:0;overflow:hidden;\}/);
  // 最小送り・上端・下端は旧 330px 基準の px 値を現在の高さの % へ換算
  assert.match(reportBlock, /const MIN_TOP = \(1\.65 \/ DAY_LANE_HEIGHT_PX\) \* 100;/);
  assert.match(reportBlock, /const MAX_TOP = \(\(DAY_LANE_HEIGHT_PX - 13\.2\) \/ DAY_LANE_HEIGHT_PX\) \* 100;/);
  assert.match(reportBlock, /const GAP = \(10\.56 \/ DAY_LANE_HEIGHT_PX\) \* 100;/);
  // 時刻順・最小間隔・下端超過時の上方向補正・過密リスト・超過件数・1行省略は維持
  assert.match(reportBlock, /for\(let i = 1; i < n; i\+\+\) tops\[i\] = Math\.max\(tops\[i\], tops\[i - 1\] \+ GAP\)/);
  assert.match(reportBlock, /const shift = Math\.min\(overflow, tops\[0\] - MIN_TOP\)/);
  assert.match(reportBlock, /rest > 0 \? `<div class="report-list-more">…ほか \$\{rest\} 件<\/div>`/);
  assert.match(printCss, /\.report-event-text\{[^}]*text-overflow:ellipsis/);
});

test('一覧表は固定行数ではなく折返し後の見積り高さで継続カードへ分ける', () => {
  const helper = reportBlock.slice(reportBlock.indexOf('const estimateRowHeightPx ='), reportBlock.indexOf('const meds = petMedications()'));
  // 固定行数での分割はしない
  assert.doesNotMatch(reportBlock, /REPORT_TABLE_ROWS_PER_CARD\b/);
  assert.doesNotMatch(helper, /i \+= \d+\)/);
  // 印刷幅で各セルを折り返した行数から高さを見積もる（pre 指定列は \n も考慮）
  assert.match(reportBlock, /const PRINT_TABLE_WIDTH_PX = \d+;/);
  assert.match(reportBlock, /const PRINT_TABLE_CARD_BODY_PX = \d+;/);
  assert.match(helper, /const perLine = Math\.max\(1, Math\.floor\(innerPx \/ PRINT_TABLE_CHAR_PX\)\)/);
  assert.match(helper, /col\.pre \? String\(text \?\? ''\)\.split\('\\n'\) : \[String\(text \?\? ''\)\]/);
  assert.match(helper, /Math\.ceil\(seg\.length \/ perLine\)/);
  // 見積り高さを積み上げ、カード予算を超えたら次のカードへ
  assert.match(helper, /curPx \+ h > PRINT_TABLE_CARD_BODY_PX/);
  // 1行だけで1ページを超える行は単独カード(overflow)にして内容を落とさない
  assert.match(helper, /const overflowAlone = h > PRINT_TABLE_CARD_BODY_PX/);
  assert.match(helper, /chunks\.push\(\{ rows: \[cells\], overflow: true \}\)/);
  assert.match(helper, /if\(chunk\.overflow\)\{/);
  // 表題は2枚目以降「(続き)」
  assert.match(helper, /i === 0 \? title : `\$\{title\}\(続き\)`/);
  // 通常カード: 表の外の <h2> 表題ひとつ＋<thead> の列見出し（重複表示しない）
  assert.match(helper, /const colHeadRow = `<tr>\$\{columns\.map\(c => `<th>\$\{escapeHtml\(c\.header\)\}<\/th>`\)/);
  assert.match(helper, /<h2 style="font-size:15px;">\$\{escapeHtml\(heading\)\}<\/h2>\s*<table>\$\{colGroupHtml\}<thead>\$\{colHeadRow\}<\/thead>/);
  // overflow カード: 表題(report-table-title 行)も列見出しも <thead> に入れて
  // table-header-group で全ての物理ページ先頭に再掲する。<h2> は出さない（先頭ページで重複しない）
  assert.match(helper, /<section class="report-table-card report-table-card--overflow">\s*<table>\$\{colGroupHtml\}<thead>\s*<tr class="report-table-title"><th colspan="\$\{columns\.length\}"[^>]*>\$\{escapeHtml\(heading\)\}<\/th><\/tr>\s*\$\{colHeadRow\}\s*<\/thead>/);
  assert.doesNotMatch(helper.slice(helper.indexOf('if(chunk.overflow)'), helper.indexOf('// 通常カード')), /<h2/);
  // 列幅は colgroup で固定し、極端に長い1セルでも他列を潰さない
  assert.match(helper, /const colGroupHtml = `<colgroup>\$\{columns\.map\(c => `<col style="width:\$\{\(c\.w \* 100\)\.toFixed\(2\)\}%;">`\)/);
  assert.match(printCss, /\.report-table-card table\{table-layout:fixed;\}/);
  assert.match(printCss, /\.report-table-card thead\{display:table-header-group;\}/);
  // overflow の表題行はセル枠なしで <h2> と同じ体裁
  assert.match(printCss, /\.report-table-card \.report-table-title th\{[\s\S]*?border:0;[\s\S]*?font-size:15px;/);
  // 通常カードはカード単位で改ページ、overflow カードだけカード内改ページを許可
  assert.match(printCss, /\.report-table-card,[\s\S]*break-inside:avoid-page/);
  assert.match(printCss, /\.report-table-card--overflow\{break-inside:auto;page-break-inside:auto;\}/);
  assert.match(printCss, /\.report-table-card--overflow tbody tr,[\s\S]*?break-inside:auto/);
  // 投薬・ごはん・予防・受診歴すべてがこの経路（列定義＋プレーンテキスト配列で渡す）
  assert.match(reportBlock, /reportTableCards\('投薬状況',\s*\[\{ header:'薬'/);
  assert.match(reportBlock, /reportTableCards\('登録しているごはん',\s*\[\{ header:'名前'/);
  assert.match(reportBlock, /reportTableCards\('予防接種・ノミダニ\/フィラリア予防',\s*\[\{ header:'種類'/);
  assert.match(reportBlock, /reportTableCards\('受診歴',\s*\[\{ header:'受診日'/);
  // ごはんの「内容」列は pre（改行保持）指定
  assert.match(reportBlock, /\{ header:'内容', w:[0-9.]+, pre:true \}/);
});

test('グラフ・資料は毎日の記録の後、まとめて新しいページから始める', () => {
  assert.match(reportBlock, /const resourcesInner = \[\s*chartsHtml, symptomBlockHtml, dailyStatusHtml,\s*mealProfilesHtml, visitsHtml, medsHtml, prevsHtml,\s*\]\.filter\(Boolean\)\.join\(''\)/);
  assert.match(reportBlock, /resourcesInner \? `<section class="report-resources">\$\{resourcesInner\}<\/section>` : ''/);
  assert.match(printCss, /\.report-resources\{break-before:page;page-break-before:always;\}/);
});

test('症状の日数と症状タイムラインは1つの塊で、通常量は同じページに保つ', () => {
  // 日数→タイムラインを1つの section にまとめ、その塊を break-inside:avoid にする
  assert.match(reportBlock, /const symptomBlockHtml = `<section class="report-symptom-block">\$\{symptomCountHtml\}\$\{symptomTimelineHtml\}<\/section>`;/);
  assert.match(printCss, /\.report-symptom-block\{break-inside:avoid-page;page-break-inside:avoid;\}/);
  // 日々の状態は塊の後ろ（間に挟まない）
  assert.match(reportBlock, /symptomBlockHtml, dailyStatusHtml,/);
  // 塊が1ページに収まらない場合のフォールバック: 日数の後で切りたくない／タイムライン分割は継続
  assert.match(reportBlock, /class="report-keep-together report-symptom-count"/);
  assert.match(reportBlock, /class="report-keep-together report-symptom-timeline"/);
  assert.match(printCss, /\.report-symptom-count\{break-after:avoid-page;page-break-after:avoid;\}/);
  assert.match(printCss, /\.report-symptom-timeline\{break-before:avoid-page;page-break-before:avoid;\}/);
  // タイムラインは14日ごとに分割（表単位で継続でき、内容を欠落させない）
  assert.match(reportBlock, /buildSymptomTimelineHtml\(symptomRecords, \{ chunkSize: PRINT_TIMELINE_CHUNK_DAYS \}\)/);
  assert.match(reportBlock, /const PRINT_TIMELINE_CHUNK_DAYS = 14;/);
});
