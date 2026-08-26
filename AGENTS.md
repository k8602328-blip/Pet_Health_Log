# AGENTS.md — クライアント（別git管理）

共通の開発ルール・分担ルール・実装契約の様式・事故パターンは、親ディレクトリの [../AGENTS.md](../AGENTS.md) に集約されている。**まずそちらを読むこと。**

## ⚠️ このリポジトリ固有の最重要注意

**`git push origin main` はそのまま本番デプロイ。** GitHub Pagesが自動ビルドし、1分以内に本番反映される（このバックエンドリポジトリの`git push`とは違い、そちらは本番に無関係）。

クライアント側の変更が未デプロイのCloud FunctionsやFirestore Rules変更に依存している場合は、必ず親ディレクトリで`firebase deploy`を先に実行して本番反映を確認してから、ここをpushする。

テストコマンド: `npm test`（`node --test test/*.test.js`）
