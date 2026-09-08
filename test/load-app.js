'use strict';

// index.htmlはビルドステップの無い1枚のHTMLファイルなので、Node側からrequire()は
// できない。この中の唯一のインラインscript(src属性の無い<script>...</script>、
// firebase/Chart.jsのCDN読み込みタグ以外)を取り出し、firebase/document/window/
// navigator等を最小限のスタブに差し替えた上で実行する。
//
// スタブが必要な理由: スクリプト先頭でfirebase.initializeApp()やdb.enablePersistence()
// を即時呼び出しており、末尾ではdocument.addEventListener()でイベント登録している
// ため(コールバック自体は本テストでは一度も発火しない)。これらが無いとスクリプトの
// 読み込み自体が例外で止まってしまう。
//
// index.html側は<script>の末尾に
//   if (typeof module !== 'undefined') module.exports = { ... };
// という1行(ブラウザ実行時は無害)を追加してあり、ここで渡すmoduleオブジェクトの
// exportsに、テスト対象の純粋関数と、破壊的処理検証用の最小シーム
// (App / state / __setTestUser)が入って返ってくる。
//
// loadApp() は従来どおり引数なしで純粋関数テスト用に使える。deletePet のように
// firebase/確認ダイアログへ触れる処理を実行したいテストは、loadApp({ firebase,
// confirm, prompt, alert, ... }) の形で必要なスタブだけ差し替える。

const fs = require('node:fs');
const path = require('node:path');

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('index.html内にインラインの<script>ブロックが見つかりません。');
  }
  return match[1];
}

function loadApp(options = {}) {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const source = extractInlineScript(fs.readFileSync(htmlPath, 'utf8'));

  const firebaseStub = options.firebase || {
    initializeApp: () => {},
    auth: () => ({}),
    firestore: () => ({ enablePersistence: () => ({ catch: () => {} }) }),
    app: () => ({ functions: () => ({}) }),
  };
  const documentStub = options.document || { addEventListener: () => {}, getElementById: () => null };
  const windowStub = options.window || {};
  const navigatorStub = options.navigator || {};
  const consoleStub = options.console || console;
  const confirmStub = options.confirm || (() => true);
  const promptStub = options.prompt || (() => '');
  const alertStub = options.alert || (() => {});

  const moduleObj = { exports: {} };
  const run = new Function(
    'module', 'firebase', 'document', 'window', 'navigator', 'console', 'confirm', 'prompt', 'alert',
    source
  );
  run(moduleObj, firebaseStub, documentStub, windowStub, navigatorStub, consoleStub, confirmStub, promptStub, alertStub);
  return moduleObj.exports;
}

module.exports = { loadApp };
