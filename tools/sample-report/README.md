# サンプルレポート（`client/sample-report.pdf`）の再生成

「レポート出力」タブから開ける見本 PDF。**実物のレポート生成処理（`index.html` の `App.printReport()`）** に
**架空データ**（`fixture.mjs`）を流し込んで出力する。実ユーザーの記録は一切使わない。
生成スクリプトはレイアウトには一切手を入れない（サンプル専用の補正は禁止）。

## 再生成手順

```sh
cd client
node tools/sample-report/generate.mjs
```

`client/sample-report.pdf` が上書きされる。あわせて確認用に次も出力される（gitには含めない）:

- `tools/sample-report/fixture.json` … 流し込んだ架空データのダンプ
- `tools/sample-report/preview-full.png` … 印刷メディアを当てた `#printArea` 全体の縦長画像（全体の見た目確認用）
- `tools/sample-report/pages/page-NN.png` … **生成した PDF そのもの**を 1 ページずつ画像化したもの
  （PDFium / `pypdfium2` で ~150dpi レンダリング）。改ページ位置・表紙の独立・4日配置の確認はこれを使う。

## 必要環境

- macOS の Google Chrome（`/Applications/Google Chrome.app`）。`generate.mjs` がヘッドレスで起動し、
  CDP（Chrome DevTools Protocol）で操作する。
- Node 20+（内蔵 `WebSocket` を使う。追加依存なし）。
- ページ画像化に Python3 + `pypdfium2` + `Pillow`（`pip install pypdfium2 pillow`）。

## 仕組み

`generate.mjs` は:

1. `client/` を静的配信する一時 HTTP サーバを立てる
2. ヘッドレス Chrome で `index.html` を開く（ログインはしない）
3. `fixture.mjs` の内容を `state` に代入し、`App.consumeReportCreditOrPrompt` と `window.print` だけ
   スタブして `App.printReport()` を実行する（レポート組み立ては本物のコードがそのまま動く）
4. `Page.printToPDF`（A4・背景あり・余白 0.2in）で PDF を書き出す
5. `pypdfium2` で PDF の各ページを PNG 化する（`pages/page-NN.png`）

## 検証用の環境変数（`client/sample-report.pdf` は変えない）

`SAMPLE_OUT` を指定したときだけ、その別ディレクトリへ PDF とページ画像を書き出す
（コミット対象の `client/sample-report.pdf` は上書きしない）。

- `SAMPLE_FROM` / `SAMPLE_TO` … 期間を差し替える（1日・4日・5日・31日 などの確認）
- `SAMPLE_SUBSCRIBED=0` … 未加入で出力する（有料セクションの有無の確認）
- `SAMPLE_STRESS_TABLES=1` … 受診歴に長文の行を 24 件（>18 行）＋「治療内容だけで1ページを超える
  極端に長い1行」を追加する。継続カードの折返し高さ分割・表題/列見出しの再掲・欠落の有無を
  実 `App.printReport()` の出力で検証するための素材（`fixture.mjs` 自体は変えない）。

例:

```sh
SAMPLE_FROM=2026-08-26 SAMPLE_TO=2026-08-26 SAMPLE_OUT=/tmp/case-1d node tools/sample-report/generate.mjs
SAMPLE_STRESS_TABLES=1 SAMPLE_OUT=/tmp/case-stress node tools/sample-report/generate.mjs
```

## データを変えたいとき

`fixture.mjs` だけ編集する。ペット情報・期間（`PERIOD_FROM`/`PERIOD_TO`、31日以内）・
くすり・ごはん・予防・日次記録・イベントを定義している。有料限定セクション（食欲/お散歩グラフ・
タイムライン）を見本に含めるため `entitlements.subscriptionActive` は `true`、`pet.trackCibdai` も `true`。

現在の `fixture.mjs` は 18 日ぶんで、次を1つのPDFで確認できるようにしてある:

- 1ページ目が表紙単独（ロゴ＋アプリ名＋「体調記録レポート」＋ペット情報・対象期間・作成日、記録なし）
- 2ページ目以降が上段2日＋下段2日の4日/ページ。5ページ目は残り2日だけ（枠寸法は維持、空枠なし）
- 記録が午後〜夜に集中した日（`2026-08-26`）と夜間に集中した日（`2026-08-30`）
- 長い受診歴（4件）・長い一覧セル（療法食の説明・夜間救急の治療内容）

## 確認の観点（`pages/page-NN.png` を全ページ見る）

- 表紙が1ページ目だけで、記録が混ざっていない
- 2ページ目以降は4日配置で、上下の記録枠が同じ高さ・同じ寸法
- 記録枠・グラフ・タイムライン表・一覧カードが改ページで途中分断されていない
- 見出しだけが前ページ末尾に取り残されていない（ごはん・受診・投薬・予防）
- 日本語の文字切れ・見切れ・枠の重なり・不要な白紙ページがない
- 現行仕様の項目が一通り出ている: 毎日の記録（24時間軸）／体重・食欲・お散歩グラフ／
  症状が記録・判定された日数／日々の状態タイムライン＋凡例／症状タイムライン／登録しているごはん／
  受診歴／投薬状況／予防接種
