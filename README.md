# Google Tasks MCP Server

Google Tasks を Claude から操作できるようにする MCP (Model Context Protocol) サーバーです。
依存パッケージなし・Node.js 組み込みモジュールのみで動作します。

## 2つの動作モード

| ファイル | モード | 用途 |
|---|---|---|
| `index.js` | stdio | Claude Desktop でローカル実行 |
| `server.js` | HTTP/SSE | Cloud Run などにデプロイして使う |

## 使えるツール

| ツール | 説明 |
|---|---|
| `list_task_lists` | タスクリストを一覧表示 |
| `list_tasks` | タスクを一覧表示（完了済み含むかどうか選択可） |
| `create_task` | タスクを新規作成 |
| `update_task` | タスクのタイトル・メモ・期日を更新 |
| `complete_task` | タスクを完了にする |
| `delete_task` | タスクを削除 |

## セットアップ

### 1. Google Cloud Console で認証情報を作成

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. **APIとサービス → ライブラリ** から **Google Tasks API** を有効化
3. **APIとサービス → 認証情報** で OAuth 2.0 クライアント ID を作成
   - アプリケーションの種類: **デスクトップアプリ**
4. クライアント ID とクライアントシークレットをメモ

### 2. Refresh Token を取得

```bash
export GOOGLE_CLIENT_ID=あなたのクライアントID
export GOOGLE_CLIENT_SECRET=あなたのクライアントシークレット
node auth-setup.js
```

表示された URL をブラウザで開き、認証コードを入力すると Refresh Token が表示されます。

### 3. 環境変数を設定

```bash
cp .env.example .env
# .env を編集して取得した値を入力
```

```env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
```

## Claude Desktop での使い方（stdio モード）

`claude_desktop_config.json` に以下を追加:

```json
{
  "mcpServers": {
    "google-tasks": {
      "command": "node",
      "args": ["/path/to/google-tasks-server/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

## Cloud Run でのデプロイ（HTTP/SSE モード）

```bash
gcloud run deploy google-tasks-mcp \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --timeout 3600 \
  --set-env-vars "GOOGLE_CLIENT_ID=$(grep GOOGLE_CLIENT_ID .env | cut -d= -f2),GOOGLE_CLIENT_SECRET=$(grep GOOGLE_CLIENT_SECRET .env | cut -d= -f2),GOOGLE_REFRESH_TOKEN=$(grep GOOGLE_REFRESH_TOKEN .env | cut -d= -f2)"
```

`.env` から値を読み込んで渡す形なので、事前に `.env` を設定しておく必要があります。

デプロイ後、Claude の MCP 設定に `https://<your-cloud-run-url>/sse` を指定してください。

## ローカルでのテスト（HTTP モード）

```bash
node server.js
# → port 8080 で起動
```

## ライセンス

MIT
