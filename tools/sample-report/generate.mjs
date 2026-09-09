// もふもふカルテ サンプルレポート（client/sample-report.pdf）の再生成スクリプト。
//
// 何をするか:
//   1. client/ を静的配信する一時HTTPサーバを立てる
//   2. ヘッドレス Chrome を起動し、CDP で index.html を開く
//   3. fixture.mjs の架空データを state へ流し込み、実物の App.printReport() を実行する
//      （クレジット消費とネイティブ橋渡しだけスタブ。レポート組み立ては本物のコード）
//   4. Page.printToPDF（A4）で client/sample-report.pdf を書き出す
//   5. レビュー用に #printArea 全体の PNG（preview-full.png）も書き出す
//
// 使い方:
//   node client/tools/sample-report/generate.mjs
//
// 必要環境: macOS の Google Chrome（/Applications/Google Chrome.app）、Node 20+（内蔵 WebSocket）。
// 実ユーザーのデータは一切使わない（fixture.mjs 参照）。

import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fixture from './fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..', '..');
const OUT_PDF = path.join(CLIENT_ROOT, 'sample-report.pdf');
const OUT_PREVIEW = path.join(HERE, 'preview-full.png');
const OUT_FIXTURE_JSON = path.join(HERE, 'fixture.json');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.join(root, urlPath);
        if (!filePath.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
        let stat = await fs.stat(filePath).catch(() => null);
        if (stat && stat.isDirectory()) { filePath = path.join(filePath, 'index.html'); stat = await fs.stat(filePath).catch(() => null); }
        if (!stat) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        createReadStream(filePath).pipe(res);
      } catch (err) { res.writeHead(500); res.end(String(err)); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(150);
  }
  throw new Error(`port ${port} not up`);
}

// --- 最小 CDP クライアント（内蔵 WebSocket） ---
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Set();
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message + ' (' + JSON.stringify(msg.error.data || '') + ')')) : resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
      ws.addEventListener('error', (e) => reject(new Error('ws error: ' + (e.message || e.type))));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  waitEvent(method, sessionId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new Error('timeout waiting ' + method)); }, timeoutMs);
      const off = this.on((msg) => {
        if (msg.method === method && (!sessionId || msg.sessionId === sessionId)) { clearTimeout(t); off(); resolve(msg.params); }
      });
    });
  }
}

async function evaluate(cdp, sessionId, expression, { awaitPromise = false } = {}) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, allowUnsafeEvalBlockedByCSP: true,
  }, sessionId);
  if (r.exceptionDetails) {
    throw new Error('page eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result?.value;
}

// レビュー時の確認用に、コミットする sample-report.pdf を変えずに期間・加入状態だけ
// 差し替えて検証できるようにする（1日/4日/5日/31日、未加入 など）。既定は fixture のまま。
//   SAMPLE_FROM=2026-08-16 SAMPLE_TO=2026-08-16 SAMPLE_SUBSCRIBED=0 \
//   SAMPLE_OUT=/tmp/case-1day node tools/sample-report/generate.mjs
// SAMPLE_OUT を指定すると PDF とページ画像をそのディレクトリへ書き、client/sample-report.pdf は上書きしない。
// SAMPLE_STRESS_TABLES=1 で 受診歴 visit イベントを大量（>18行、長文多数行）＋
// 「極端に長い1行（1ページ超）」1件、さらに改行付きの「ごはん」内容1件を追加する。
// 継続カードの折返し高さ分割・表題/列見出しの全ページ再掲・欠落の有無を
// 実 App.printReport の出力で検証するための素材（既定の fixture は変えない）。
const OVERRIDE = {
  from: process.env.SAMPLE_FROM || null,
  to: process.env.SAMPLE_TO || null,
  subscribed: process.env.SAMPLE_SUBSCRIBED == null ? null : process.env.SAMPLE_SUBSCRIBED !== '0',
  outDir: process.env.SAMPLE_OUT || null,
  stressTables: process.env.SAMPLE_STRESS_TABLES ? process.env.SAMPLE_STRESS_TABLES !== '0' : false,
};

function addStressTableData(runFixture) {
  const petId = runFixture.currentPetId;
  const long = '嘔吐と下痢が持続し脱水が疑われたため皮下輸液を実施。制吐剤マロピタントを皮下注射し、整腸剤と低脂肪の消化器サポート食へ変更。翌日再診で体重と便性状を再評価する方針とした。';

  // 改行付きの「ごはん」内容（pre 列の折返し高さ見積りの検証）
  runFixture.mealProfiles.push({
    id: 'stress-meal-multiline', petId,
    label: '療法食ローテーション（3日周期）',
    description: [
      '1日目: 消化器サポート ドライ 15g + パウチ 1/4袋',
      '2日目: 低脂肪 ドライ 15g + ふやかし 大さじ1',
      '3日目: 加水した療法食 20g（少量頻回・4回に分割）',
      '共通: 投薬用ちゅ〜るは内服直前に半量、残りは食後',
      '注意: 下痢が続く日は2日目メニューへ前倒し、獣医へ連絡',
    ].join('\n'),
    suggestedTime: '07:30 / 12:30 / 19:30',
    active: true, sortOrder: 9,
  });
  // 折返しが複数行になる通常の長文行を 24 件（>18 行）
  for (let i = 0; i < 24; i++) {
    const day = String(1 + i).padStart(2, '0');
    runFixture.events.push({
      id: `stress-visit-${i}`, petId, date: `2026-07-${day}`, time: '10:00', type: 'visit',
      sortKey: `2026-07-${day}T10:00`,
      details: {
        clinic: `${i % 2 ? '夜間動物救急センター' : 'さくら動物病院'}（第${i + 1}回）`,
        reason: `${i + 1}回目の受診。前回からの経過と食欲・排便・嘔吐の頻度を確認`,
        diagnosis: '慢性腸症（食事反応性腸症の疑い、IBDとの鑑別継続中）',
        treatment: long,
        followUpDate: `2026-07-${String(Math.min(28, 3 + i)).padStart(2, '0')}`,
      },
      note: '',
    });
  }
  // 極端に長い1行（治療内容だけで1ページを超える）を 1 件
  runFixture.events.push({
    id: 'stress-visit-huge', petId, date: '2026-07-31', time: '09:00', type: 'visit',
    sortKey: '2026-07-31T09:00',
    details: {
      clinic: '大学付属動物医療センター 消化器内科',
      reason: '長期にわたる慢性腸症の精査依頼',
      diagnosis: '慢性腸症（原発性 IBD 疑い）',
      treatment: (long + ' ').repeat(24).trim(),
      followUpDate: '2026-08-14',
    },
    note: '',
  });
}

async function main() {
  const runFixture = JSON.parse(JSON.stringify(fixture));
  if (OVERRIDE.from) runFixture.period.from = OVERRIDE.from;
  if (OVERRIDE.to) runFixture.period.to = OVERRIDE.to;
  if (OVERRIDE.subscribed != null) runFixture.entitlements = { subscriptionActive: OVERRIDE.subscribed };
  if (OVERRIDE.stressTables) addStressTableData(runFixture);
  const outPdf = OVERRIDE.outDir ? path.join(OVERRIDE.outDir, 'sample-report.pdf') : OUT_PDF;
  const outPreview = OVERRIDE.outDir ? path.join(OVERRIDE.outDir, 'preview-full.png') : OUT_PREVIEW;
  const outPagesDir = OVERRIDE.outDir ? path.join(OVERRIDE.outDir, 'pages') : path.join(HERE, 'pages');
  if (OVERRIDE.outDir) await fs.mkdir(OVERRIDE.outDir, { recursive: true });

  await fs.writeFile(OUT_FIXTURE_JSON, JSON.stringify(runFixture, null, 2), 'utf8');

  const { server, port } = await startServer(CLIENT_ROOT);
  const appUrl = `http://127.0.0.1:${port}/index.html`;
  console.log('static server on', appUrl);

  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mofu-sample-report-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-translate',
    '--force-color-profile=srgb', '--font-render-hinting=none',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  chrome.stderr.on('data', () => {});

  let cleanupDone = false;
  const cleanup = async () => {
    if (cleanupDone) return; cleanupDone = true;
    try { chrome.kill('SIGKILL'); } catch {}
    server.close();
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  };
  process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });

  try {
    // DevToolsActivePort ファイルからポートを取得
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    let devtoolsPort = null;
    for (let i = 0; i < 100 && !devtoolsPort; i++) {
      await sleep(100);
      const txt = await fs.readFile(portFile, 'utf8').catch(() => '');
      if (txt) devtoolsPort = txt.split('\n')[0].trim();
    }
    if (!devtoolsPort) throw new Error('Chrome DevTools port not found');
    await waitForPort(Number(devtoolsPort));

    const verRes = await fetch(`http://127.0.0.1:${devtoolsPort}/json/version`);
    const { webSocketDebuggerUrl } = await verRes.json();
    const cdp = await CDP.connect(webSocketDebuggerUrl);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    const loaded = cdp.waitEvent('Page.loadEventFired', sessionId, 30000);
    await cdp.send('Page.navigate', { url: appUrl }, sessionId);
    await loaded;

    // アプリ本体（App / state）が立ち上がるまで待つ
    for (let i = 0; i < 100; i++) {
      const ready = await evaluate(cdp, sessionId, `(typeof App === 'object' && typeof state === 'object' && typeof Chart === 'function')`);
      if (ready) break;
      await sleep(200);
      if (i === 99) throw new Error('app globals never became ready');
    }

    // 架空データを流し込んで実物の printReport を起動
    const FIXTURE_JSON = JSON.stringify(runFixture);
    const kickoff = await evaluate(cdp, sessionId, `(async () => {
      const F = ${FIXTURE_JSON};
      window.__printCalled = false;
      window.print = () => { window.__printCalled = true; };
      App.consumeReportCreditOrPrompt = async () => true;
      const ensureInput = (id, val) => {
        let el = document.getElementById(id);
        if (!el) { el = document.createElement('input'); el.type = 'date'; el.id = id; el.style.display = 'none'; document.body.appendChild(el); }
        el.value = val; return el;
      };
      ensureInput('exFrom', F.period.from);
      ensureInput('exTo', F.period.to);
      state.pets = [F.pet];
      state.currentPetId = F.currentPetId;
      state.records = F.records;
      state.events = F.events;
      state.medications = F.medications;
      state.mealProfiles = F.mealProfiles;
      state.preventions = F.preventions;
      state.entitlements = F.entitlements;
      state.linkedOwnerUid = null;
      // printReport() は起動・初回データ受信が終わるまで(isAppReady)出力へ進まない。
      // ここでは架空データを直接流し込んでいるので、起動完了済みとして扱う。
      state.bootPhase = 'ready';
      App.printReport();
      return { started: true, records: F.records.length, events: F.events.length };
    })()`, { awaitPromise: true });
    console.log('kickoff', kickoff);

    // #printArea が埋まって window.print() が呼ばれるまでポーリング
    let status = null;
    for (let i = 0; i < 600; i++) {
      status = await evaluate(cdp, sessionId, `(() => {
        const pa = document.getElementById('printArea');
        const imgs = [...pa.querySelectorAll('img')];
        return {
          printCalled: !!window.__printCalled,
          children: pa.children.length,
          chars: pa.innerText.length,
          imgs: imgs.length,
          imgsComplete: imgs.every(im => im.complete && im.naturalWidth > 0),
          hasCover: !!pa.querySelector('.report-cover'),
          recordPages: pa.querySelectorAll('.report-record-page').length,
          tableCards: pa.querySelectorAll('.report-table-card').length,
          hasResources: !!pa.querySelector('.report-resources'),
          hasCharts: pa.querySelectorAll('.report-chart-block img').length,
          hasDailyStatus: !!pa.querySelector('.status-timeline-table'),
          hasSymptomTimeline: !!pa.querySelector('.symptom-timeline-table'),
        };
      })()`);
      if (status.printCalled && status.children > 0 && status.imgsComplete) break;
      await sleep(300);
    }
    console.log('report status', status);
    if (!status || !status.printCalled || !status.children) throw new Error('report did not render: ' + JSON.stringify(status));

    await sleep(400); // 最終レイアウト落ち着き待ち

    // --- PDF（A4） ---
    // 用紙・余白は index.html の @page{ size:A4; margin:12mm } に従わせる
    // （preferCSSPageSize:true）。実際の Chrome 印刷ダイアログと同じ余白でサンプルを作る。
    const pdf = await cdp.send('Page.printToPDF', {
      printBackground: true,
      paperWidth: 8.27, paperHeight: 11.69,
      scale: 1, preferCSSPageSize: true,
    }, sessionId);
    await fs.writeFile(outPdf, Buffer.from(pdf.data, "base64"));
    const pdfStat = await fs.stat(outPdf);
    console.log("wrote", outPdf, (pdfStat.size / 1024).toFixed(0) + " KB");

    // --- レビュー用フル PNG（印刷メディアを強制した #printArea 全体） ---
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);
    const h = await evaluate(cdp, sessionId, `(() => {
      const pa = document.getElementById('printArea');
      pa.style.width = '794px';
      return Math.min(16000, Math.ceil(pa.getBoundingClientRect().height) + 40);
    })()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 794, height: h, deviceScaleFactor: 1, mobile: false,
    }, sessionId);
    await sleep(300);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 794, height: h, scale: 1 },
    }, sessionId);
    await fs.writeFile(outPreview, Buffer.from(shot.data, "base64"));
    console.log("wrote", outPreview);

    // レビュー用に、生成した PDF そのものを 1 ページずつ画像化する（page-NN.png）。
    // 以前は縦長 PNG を等間隔でスライスしていたが、それでは @media print の実改ページ位置と
    // ずれるため、改ページ検証には使えなかった。ここでは PDFium（pypdfium2）で実 PDF の
    // 各ページを ~150dpi でレンダリングする。表紙の独立・4日配置・上下同高・重なり/切れ/
    // 白紙の有無は、この page-NN.png を全ページ見て確認する。
    const sliceDir = outPagesDir;
    await fs.rm(sliceDir, { recursive: true, force: true });
    await fs.mkdir(sliceDir, { recursive: true });
    const py = spawn('python3', ['-c', `
import sys
import pypdfium2 as pdfium
src, outdir = sys.argv[1], sys.argv[2]
pdf = pdfium.PdfDocument(src)
n = len(pdf)
for i in range(n):
    page = pdf[i]
    bitmap = page.render(scale=150/72)  # 150 dpi
    bitmap.to_pil().save(f"{outdir}/page-{i+1:02d}.png")
print(n)
`, outPdf, sliceDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let slaveOut = '';
    py.stdout.on('data', (d) => { slaveOut += d; });
    py.stderr.on('data', (d) => { slaveOut += d; });
    await new Promise((res) => py.on('close', res));
    console.log('PDF pages rendered:', slaveOut.trim(), '->', path.relative(process.cwd(), sliceDir));

    console.log('\nDONE. PDF pages:', /\/Count (\d+)/.test(Buffer.from(pdf.data, 'base64').toString('latin1')) ? RegExp.$1 : '?');
    console.log("Verify all pages of", path.relative(process.cwd(), outPdf));
  } finally {
    await cleanup();
  }
}

main().catch(async (err) => { console.error(err); process.exitCode = 1; });
