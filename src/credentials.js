import fs from "node:fs/promises";
import path from "node:path";
import { CLIENT_ID, TOKEN_URL } from "./constants.js";
import { getAccountIdFromToken, getCredentialsPath } from "./utils.js";

export async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readCredentials(filePath = getCredentialsPath()) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeCredentials(credentials, filePath = getCredentialsPath()) {
  await ensureParentDir(filePath);
  const payload = {
    version: 1,
    ...credentials,
    updated_at: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return payload;
}

export function credentialsNeedRefresh(credentials, skewSeconds = 300) {
  const expiresAt = Number(credentials?.expires_at || 0);
  if (!expiresAt) return true;
  return Date.now() + skewSeconds * 1000 >= expiresAt;
}

export async function refreshCredentials(filePath = getCredentialsPath()) {
  const current = await readCredentials(filePath);
  if (!current?.refresh_token) {
    throw new Error(`Missing refresh_token in ${filePath}`);
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: CLIENT_ID,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${raw}`);
  }

  const json = JSON.parse(raw);
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error(`Token refresh response missing fields: ${raw}`);
  }

  return writeCredentials(
    {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + json.expires_in * 1000,
      account_id: getAccountIdFromToken(json.access_token),
      token_type: json.token_type || "Bearer",
      scope: json.scope,
    },
    filePath,
  );
}

export async function getValidCredentials(filePath = getCredentialsPath()) {
  const current = await readCredentials(filePath);
  if (!credentialsNeedRefresh(current)) {
    return current;
  }
  return refreshCredentials(filePath);
}
