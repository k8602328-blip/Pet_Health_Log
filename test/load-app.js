'use strict';

// index.htmlはビルドステップの無い1枚のHTMLファイルなので、Node側からrequire()は
// できない。この中の唯一のインラインscript(src属性の無い<script>...</script>、
// firebase/Chart.jsのCDN読み込みタグ以外)を取り出し、firebase/document/window/
// navigatorを最小限のスタブに差し替えた上で実行する。
//
// スタブが必要な理由: スクリプト先頭でfirebase.initializeApp()やdb.enablePersistence()
// を即時呼び出しており、末尾ではdocument.addEventListener()でイベント登録している
// ため(コールバック自体は本テストでは一度も発火しない)。これらが無いとスクリプトの
// 読み込み自体が例外で止まってしまう。
//
// index.html側は<script>の末尾に
//   if (typeof module !== 'undefined') module.exports = { ... };
// という1行(ブラウザ実行時は無害)を追加してあり、ここで渡すmoduleオブジェクトの
// exportsに、テスト対象の純粋関数だけが入って返ってくる。

const fs = require('node:fs');
const path = require('node:path');

function extractInlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('index.html内にインラインの<script>ブロックが見つかりません。');
  }
  return match[1];
}

function loadApp() {
  const htmlPath = path.join(__dirname, '..', 'index.html');
  const source = extractInlineScript(fs.readFileSync(htmlPath, 'utf8'));

  const firebaseStub = {
    initializeApp: () => {},
    auth: () => ({}),
    firestore: () => ({ enablePersistence: () => ({ catch: () => {} }) }),
    app: () => ({ functions: () => ({}) }),
  };
  const documentStub = { addEventListener: () => {}, getElementById: () => null };
  const windowStub = {};
  const navigatorStub = {};

  const moduleObj = { exports: {} };
  const run = new Function(
    'module', 'firebase', 'document', 'window', 'navigator',
    source
  );
  run(moduleObj, firebaseStub, documentStub, windowStub, navigatorStub);
  return moduleObj.exports;
}

module.exports = { loadApp };
