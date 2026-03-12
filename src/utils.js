import crypto from "node:crypto";
import { DEFAULT_CREDENTIALS_FILE, DEFAULT_DATA_DIR, DEFAULT_MODELS, JWT_CLAIM_PATH } from "./constants.js";

export function getDataDir() {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

export function getCredentialsPath() {
  return process.env.CREDENTIALS_FILE || `${getDataDir().replace(/\/+$/, "")}/${DEFAULT_CREDENTIALS_FILE}`;
}

export function getBridgeApiKey() {
  return process.env.BRIDGE_API_KEY || "";
}

export function getListenPort() {
  const raw = process.env.PORT || "";
  const port = Number.parseInt(raw, 10);
  return Number.isFinite(port) && port > 0 ? port : 8088;
}

export function getCodexBaseUrl() {
  return (process.env.CODEX_BASE_URL || "").trim() || undefined;
}

export function getModels() {
  const raw = (process.env.CODEX_BRIDGE_MODELS || "").trim();
  if (!raw) return [...DEFAULT_MODELS];
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

export function getDefaultModel() {
  return (process.env.CODEX_DEFAULT_MODEL || "").trim() || getModels()[0] || "gpt-5.4";
}

export function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

export function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT token");
  }
  const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));
  return payload;
}

export function getAccountIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  if (!accountId || typeof accountId !== "string") {
    throw new Error("Token missing chatgpt_account_id");
  }
  return accountId;
}

export function pkceChallengeFromVerifier(verifier) {
  return base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
}

export function toPlainText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      if (part?.type === "input_text") return part.text || "";
      if (part?.type === "output_text") return part.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function json(value) {
  return JSON.stringify(value, null, 2);
}

export function shortError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
