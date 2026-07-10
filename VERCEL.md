# VercelでGAS連携を使う手順

GitHubにこのフォルダを入れてVercelへデプロイすると、アプリは `/api/gas` 経由でGoogle Apps Scriptに保存・読込します。

## 0. Vercelのプロジェクト設定

GitHubリポジトリの直下に `todo-list-tool` フォルダがある構成で使う場合は、VercelのImport時にRoot Directoryを `todo-list-tool` にします。

- Framework Preset: `Other`
- Build Command: 空欄
- Output Directory: 空欄または `.`

## 1. GASをデプロイする

1. Googleスプレッドシートを作成します。
2. `gas/Code.gs` をApps Scriptに貼り付けます。
3. Apps Scriptを「ウェブアプリ」としてデプロイします。
4. 実行ユーザーは「自分」にします。
5. アクセスできるユーザーは、まず「全員」または「リンクを知っている全員」にします。
6. 発行された `https://script.google.com/macros/s/.../exec` を控えます。

## 2. Vercelに環境変数を設定する

VercelのProject SettingsでEnvironment Variablesを開き、次を追加します。

```text
GAS_WEB_APP_URL=https://script.google.com/macros/s/.../exec
```

Production、Previewのどちらで使うかに合わせて適用先を選びます。

環境変数を追加・変更した後は、Vercelで再デプロイしてください。

## 3. アプリ側の使い方

- Vercel上では、GAS設定画面の「WebアプリURL」は空欄のままで使えます。
- 初回表示時にVercel APIの設定が確認できると、自動保存はONになります。
- 手元ですでにGAS設定を保存しているブラウザでは、その手元設定が優先されます。
- 接続確認は「連携」→「GAS設定」→「接続確認」で行えます。

## セキュリティメモ

VercelのAPIが公開されている場合、そのURLを知っている人が保存APIにアクセスできる可能性があります。個人用に使う場合は、VercelのDeployment Protectionやアクセス制限の利用を検討してください。
