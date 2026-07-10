const GAS_WEB_APP_URL = "GAS_WEB_APP_URL";

module.exports = async (request, response) => {
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  try {
    const action = getAction(request);

    if (request.method === "GET" && action === "config") {
      response.status(200).json({
        ok: true,
        configured: Boolean(process.env[GAS_WEB_APP_URL]),
        mode: "vercel",
      });
      return;
    }

    if (request.method === "GET") {
      const result = await callGasGet(action);
      response.status(200).json(result);
      return;
    }

    if (request.method === "POST") {
      const payload = await readRequestJson(request);
      const result = await callGasPost({ ...payload, action: payload.action || action || "save" });
      response.status(200).json(result);
      return;
    }

    response.setHeader("Allow", "GET, POST, OPTIONS");
    response.status(405).json({ ok: false, error: "Method not allowed." });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }
};

function getAction(request) {
  if (request.query && request.query.action) return String(request.query.action).toLowerCase();
  const url = new URL(request.url || "/", "http://localhost");
  return String(url.searchParams.get("action") || "ping").toLowerCase();
}

function getGasUrl() {
  const value = process.env[GAS_WEB_APP_URL];
  if (!value) throw new Error(`Vercelの環境変数 ${GAS_WEB_APP_URL} が未設定です。`);

  const url = new URL(value);
  if (url.protocol !== "https:" || !/script\.google\.com$/.test(url.hostname) || !url.pathname.includes("/macros/")) {
    throw new Error(`${GAS_WEB_APP_URL} にはApps ScriptのWebアプリURLを設定してください。`);
  }
  return url;
}

async function callGasGet(action) {
  const url = getGasUrl();
  url.searchParams.set("action", action || "ping");
  url.searchParams.set("_", String(Date.now()));

  const gasResponse = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseGasResponse(gasResponse);
}

async function callGasPost(payload) {
  const gasResponse = await fetch(getGasUrl().toString(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload || {}),
  });
  return parseGasResponse(gasResponse);
}

async function parseGasResponse(gasResponse) {
  const text = await gasResponse.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: text || "GASからJSON以外の応答が返りました。" };
  }

  if (!gasResponse.ok) {
    throw new Error(data.error || `GASへの接続に失敗しました。(${gasResponse.status})`);
  }

  return data;
}

async function readRequestJson(request) {
  if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body)) return parseJson(request.body.toString("utf8"));
    if (typeof request.body === "string") return parseJson(request.body);
    if (typeof request.body === "object") return request.body;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return parseJson(text || "{}");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("リクエスト本文のJSONを読み取れませんでした。");
  }
}
