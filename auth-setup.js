#!/usr/bin/env node
/**
 * Google Tasks OAuth2 認証セットアップ（依存パッケージ不要）
 * WSL2 または Windows の Node.js で実行できます
 *
 * 使い方:
 *   node auth-setup.js
 */
const https = require("https");
const readline = require("readline");

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Error: 環境変数を設定してください");
  console.error("  export GOOGLE_CLIENT_ID=あなたのクライアントID");
  console.error("  export GOOGLE_CLIENT_SECRET=あなたのクライアントシークレット");
  process.exit(1);
}

const SCOPE = "https://www.googleapis.com/auth/tasks";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

console.log("\n=== Google Tasks 認証セットアップ ===\n");
console.log("1. 以下のURLをブラウザで開いてください:\n");
console.log(authUrl);
console.log("\n2. Googleアカウントでログインして「許可」をクリック");
console.log("3. 表示された認証コードをここに貼り付けてください\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("認証コード: ", async (code) => {
  rl.close();
  try {
    const body = new URLSearchParams({
      code: code.trim(),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString();

    const result = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: "POST",
          hostname: "oauth2.googleapis.com",
          path: "/token",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => resolve(JSON.parse(buf)));
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    if (!result.refresh_token) {
      console.error("\n失敗しました:", JSON.stringify(result, null, 2));
      process.exit(1);
    }

    console.log("\n=== 認証成功！ ===");
    console.log("\nCoworkのプラグイン設定に以下の3つを入力してください:\n");
    console.log(`GOOGLE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${result.refresh_token}`);
    console.log("\n✅ この3つをメモしてCoworkの環境変数設定に入力してください。");
  } catch (err) {
    console.error("エラー:", err.message);
    process.exit(1);
  }
});
