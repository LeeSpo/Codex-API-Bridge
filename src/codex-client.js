import { DEFAULT_CODEX_BASE_URL } from "./constants.js";
import { getValidCredentials } from "./credentials.js";
import { getCodexBaseUrl } from "./utils.js";

export function resolveCodexUrl(baseUrl = getCodexBaseUrl()) {
  const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

export function buildCodexHeaders({ accessToken, accountId, sessionId }) {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("chatgpt-account-id", accountId);
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("originator", process.env.CODEX_ORIGINATOR || "codex-bridge");
  headers.set("User-Agent", `codex-bridge (${process.platform} ${process.arch}; node ${process.version})`);
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  if (sessionId) headers.set("session_id", sessionId);
  return headers;
}

export async function startCodexRequest({ body, credentialsFile, sessionId, signal }) {
  const credentials = await getValidCredentials(credentialsFile);
  const headers = buildCodexHeaders({
    accessToken: credentials.access_token,
    accountId: credentials.account_id,
    sessionId,
  });

  const response = await fetch(resolveCodexUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Codex upstream error (${response.status}): ${raw}`);
  }

  if (!response.body) {
    throw new Error("Codex upstream returned no response body");
  }

  return response;
}
