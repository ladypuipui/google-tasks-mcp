# Google Tasks MCP Server

Google Tasks を Claude から操作できるようにする MCP (Model Context Protocol) サーバーです。
依存パッケージなし・Node.js 組み込みモジュールのみで動作します。

## 構成と2つの動作モード

認証・Google Tasks API・ツール定義は `core.js` に集約され、2つのエントリから共有されます。
どちらのモードでも同じツール・同じ挙動になります。

| ファイル | モード | 用途 |
|---|---|---|
| `core.js` | （共通コア） | 認証・API・ツール定義。両エントリが require する |
| `index.js` | stdio | Claude Code / Claude Desktop でローカル実行（推奨） |
| `server.js` | HTTP/SSE | Docker 常駐 / Cloud Run などにデプロイして使う |

## 使えるツール

### タスクリスト操作

| ツール | 説明 |
|---|---|
| `list_task_lists` | タスクリストを一覧表示 |
| `create_task_list` | タスクリストを新規作成 |
| `update_task_list` | タスクリストの名前を変更 |
| `delete_task_list` | タスクリストをすべてのタスクごと削除 |

### タスク操作

| ツール | 説明 |
|---|---|
| `list_tasks` | タスクを一覧表示（`showCompleted: true` で完了済みも取得、完了日時も返す）。サブタスクは `parent` フィールドに親タスクのIDが入る |
| `create_task` | タスクを新規作成。`parent` に親タスクのIDを指定するとサブタスクとして作成される |
| `update_task` | タスクのタイトル・メモ・期日を更新 |
| `complete_task` | タスクを完了にする |
| `delete_task` | タスクを削除 |
| `move_task` | タスクを並び替え・移動する。`toTaskListId` を省略すると同一リスト内での並び替え。`previous` に直前に置きたいタスクのIDを指定（省略するとリスト先頭）。別リストへの移動時はタスクIDが変わる |

### タスクの並び替え（`move_task`）

`toTaskListId` を省略すると同一リスト内での並び替えになります。Google Tasks API のネイティブ `move` エンドポイントを使用するため、タスクIDは変わりません。

| パラメータ | 必須 | 説明 |
|---|---|---|
| `taskId` | ✓ | 移動・並び替えするタスクのID |
| `fromTaskListId` | | 元のタスクリストID（省略時はデフォルトリスト） |
| `toTaskListId` | | 移動先リストID（**省略すると同一リスト内の並び替え**） |
| `previous` | | このタスクIDの**直後**に配置する（省略するとリスト先頭） |
| `parent` | | 親タスクID（サブタスクとして入れ子にする場合） |

**例：スプリントバックログのように並び替える**

```
# タスクAをリスト先頭へ
move_task(taskId="A")

# タスクBをタスクAの直後へ
move_task(taskId="B", previous="A")

# タスクCをタスクBの直後へ
move_task(taskId="C", previous="B")
```

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

## ローカルで実行する

`.env` を設定してあれば、Node.js 22 の `--env-file` で読み込んで起動できます（依存パッケージ不要）。

```bash
npm run start:stdio   # stdio モード（node --env-file=.env index.js）
npm start             # HTTP/SSE モード（node --env-file=.env server.js → port 8080）
npm test              # セキュリティ + HTTP エンドポイントのテスト
```

> `--env-file=.env` を使うには事前に `.env` が存在している必要があります（手順3を参照）。

## Claude Code / Claude Desktop での使い方（stdio モード）

設定ファイル（`claude_desktop_config.json` または `.mcp.json`）に以下を追加します。

**A) Node で直接起動（`--env-file` で `.env` を読み込む）**

```json
{
  "mcpServers": {
    "google-tasks": {
      "command": "node",
      "args": ["--env-file=/path/to/google-tasks-mcp/.env", "/path/to/google-tasks-mcp/index.js"]
    }
  }
}
```

**B) env を直接書く**

```json
{
  "mcpServers": {
    "google-tasks": {
      "command": "node",
      "args": ["/path/to/google-tasks-mcp/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

**C) Docker で起動（stdio）**

```json
{
  "mcpServers": {
    "google-tasks": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--env-file", "/path/to/google-tasks-mcp/.env", "google-tasks-mcp", "node", "index.js"]
    }
  }
}
```

事前に `docker build -t google-tasks-mcp .` でイメージをビルドしておきます。

## Docker で動かす（HTTP/SSE モード）

`.env` を用意したうえで、Compose で常駐させるのが手軽です。

```bash
docker compose up -d --build
# → http://localhost:8080/sse で接続可能
```

ビルドだけ・単発実行したい場合:

```bash
docker build -t google-tasks-mcp .
docker run --rm --env-file .env -p 8080:8080 google-tasks-mcp
```

> stdio モードを Docker で使う場合は常駐ではなく、MCP クライアントから
> `docker run -i --rm --env-file .env google-tasks-mcp node index.js` のように
> 1回ごとに起動します（上の「Claude Code / Claude Desktop での使い方」C を参照）。

## Cloud Run でのデプロイ（HTTP/SSE モード）

```bash
gcloud run deploy google-tasks-mcp \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --timeout 3600 \
  --set-env-vars "GOOGLE_CLIENT_ID=$(grep GOOGLE_CLIENT_ID .env | cut -d= -f2),GOOGLE_CLIENT_SECRET=$(grep GOOGLE_CLIENT_SECRET .env | cut -d= -f2),GOOGLE_REFRESH_TOKEN=$(grep GOOGLE_REFRESH_TOKEN .env | cut -d= -f2)"
```

`.env` から値を読み込んで渡す形なので、事前に `.env` を設定しておく必要があります。

デプロイ後、Claude の MCP 設定に `https://<your-cloud-run-url>/sse` を指定してください。

## Cowork での使い方

Cloud Run にデプロイ後、Cowork の MCP コネクタとして接続できます。

### MCP コネクタの追加

Cowork の設定画面でカスタム MCP サーバーを追加し、以下の設定を入力してください：

| 項目 | 値 |
|---|---|
| Type | SSE |
| URL | `https://<your-cloud-run-url>/sse` |

`<your-cloud-run-url>` は `gcloud run deploy` 後に表示される URL です。

### .mcp.json で管理する場合

プロジェクトルートに `.mcp.json` を作成することでも設定できます：

```json
{
  "mcpServers": {
    "google-tasks": {
      "type": "sse",
      "url": "https://<your-cloud-run-url>/sse"
    }
  }
}
```

## ライセンス

MIT
