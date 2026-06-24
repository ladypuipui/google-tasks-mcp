# Google Tasks MCP Server — zero-dependency Node.js
# 既定では HTTP/SSE サーバー (server.js) を起動する。
# stdio で使う場合は実行時に `node index.js` で上書きする:
#   docker run -i --rm --env-file .env <image> node index.js
FROM node:22-slim

WORKDIR /app

# 依存パッケージなし。アプリ本体のみコピーする。
COPY package.json ./
COPY core.js index.js server.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
