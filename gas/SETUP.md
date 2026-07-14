# GAS連携の設定手順

1. Googleスプレッドシートを新規作成します。
2. メニューから「拡張機能」→「Apps Script」を開きます。
3. `Code.gs` の中身を、このフォルダの `Code.gs` に置き換えます。
4. Apps Script画面で「デプロイ」→「新しいデプロイ」を選びます。
5. 種類は「ウェブアプリ」にします。
6. 実行するユーザーは「自分」、アクセスできるユーザーは自分の運用に合わせて選びます。
   ローカルHTMLから使う場合は、まず「全員」または「リンクを知っている全員」で試すのが簡単です。
7. デプロイ後に表示される `https://script.google.com/macros/s/.../exec` のURLをコピーします。
8. To do Listツールで「GAS設定」を開き、URLを貼り付けて保存します。
9. 「接続確認」でスプレッドシート名が表示されれば連携完了です。

## Vercelで使う場合

Vercelでは、アプリ画面にURLを貼り付けずに使えます。

1. VercelのProject SettingsでEnvironment Variablesを開きます。
2. `GAS_WEB_APP_URL` にApps ScriptのWebアプリURLを設定します。
3. Vercelで再デプロイします。
4. アプリ画面では「WebアプリURL」を空欄のままにします。

詳しい手順は、リポジトリ直下の `VERCEL.md` を見てください。

## 使い方

- `GAS保存`: 現在のタスク、日課、目的、日次レビューをスプレッドシートへ保存します。
- `GAS読込`: スプレッドシートの内容を画面へ読み込みます。
- `変更時に自動でGASへ保存`: ブラウザ内保存の少し後にGASへも送信します。

## 作成されるシート

- `Tasks`: タスク一覧
- `FocusTasks`: 今日扱うタスクの日付別一覧
- `Routines`: 日課一覧
- `RoutineLog`: 日課の実行ログ
- `RoutineProgress`: 日課の継続状況
- `Projects`: 目的 / プロジェクト一覧
- `DailyReview`: 日次レビュー
- `AppState`: アプリ復元用の完全データ
