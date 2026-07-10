# To do List Tool

日課、四象限To do、今日扱うタスク、目的別ガントチャートをひとつにまとめた、ブラウザで動く個人用タスク管理ツールです。

## 主な機能

- 毎日のルーチン管理
- 第1象限から第4象限までのTo do整理
- 今日扱うタスクの選択
- 目的 / プロジェクト別のガントチャート
- Excel形式の読み込み / 書き出し
- Google Apps Script経由のGoogleスプレッドシート保存

## フォルダ構成

```text
todo-list-tool/
  index.html        # アプリ画面
  styles.css        # デザイン
  app.js            # アプリの動作
  gas/
    Code.gs         # Google Apps Script用コード
    SETUP.md        # GAS連携の設定手順
  api/
    gas.js          # Vercel用GAS中継API
  VERCEL.md         # Vercel環境変数での設定手順
  package.json      # ローカル起動とチェック用
```

## ローカルで開く

このフォルダで次を実行します。

```bash
npm start
```

ブラウザで `http://127.0.0.1:8765/` を開きます。

Windows PowerShellで `npm` が止まる場合は、次のどちらかを使ってください。

```bash
npm.cmd start
```

```bash
python -m http.server 8765
```

ビルドは不要です。HTML、CSS、JavaScriptだけで動きます。

## Googleスプレッドシート連携

GAS連携を使う場合は、[gas/SETUP.md](gas/SETUP.md) の手順に沿って設定してください。

Vercelで公開する場合は、GAS URLをアプリ画面に貼り付けず、Vercelの環境変数 `GAS_WEB_APP_URL` に設定できます。詳しくは [VERCEL.md](VERCEL.md) を見てください。

## GitHub Pagesで公開する場合

GitHubにアップロードしたあと、リポジトリの `Settings` → `Pages` で公開元を選ぶと、そのまま静的サイトとして公開できます。

注意: GAS URLや個人データはブラウザの保存領域に保存されます。公開リポジトリに個人データ入りのExcelファイルなどを置かないようにしてください。
