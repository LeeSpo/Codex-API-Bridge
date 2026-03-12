import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AUTHORIZE_URL, CLIENT_ID, REDIRECT_URI, TOKEN_URL } from "./constants.js";
import { getAccountIdFromToken, pkceChallengeFromVerifier, randomHex } from "./utils.js";
import { writeCredentials } from "./credentials.js";

export function buildAuthorizationUrl({ verifier, state, originator = "codex-bridge" }) {
  const challenge = pkceChallengeFromVerifier(verifier);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", originator);
  return url.toString();
}

export function parseAuthorizationInput(value) {
  const inputValue = String(value || "").trim();
  if (!inputValue) return {};

  try {
    const url = new URL(inputValue);
    return {
      code: url.searchParams.get("code") || undefined,
      state: url.searchParams.get("state") || undefined,
    };
  } catch {
    // fall through
  }

  if (inputValue.includes("code=")) {
    const params = new URLSearchParams(inputValue);
    return {
      code: params.get("code") || undefined,
      state: params.get("state") || undefined,
    };
  }

  if (inputValue.includes("#")) {
    const [code, state] = inputValue.split("#", 2);
    return { code: code || undefined, state: state || undefined };
  }

  return { code: inputValue };
}

export async function exchangeAuthorizationCode({ code, verifier }) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Code exchange failed (${response.status}): ${raw}`);
  }

  const json = JSON.parse(raw);
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error(`Token response missing fields: ${raw}`);
  }

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    account_id: getAccountIdFromToken(json.access_token),
    token_type: json.token_type || "Bearer",
    scope: json.scope,
  };
}

export async function interactiveLogin({ credentialsFile, originator = "codex-bridge" }) {
  const verifier = randomHex(32);
  const state = randomHex(16);
  const url = buildAuthorizationUrl({ verifier, state, originator });

  console.log("\nOpen this URL in your browser and finish login:\n");
  console.log(url);
  console.log("\nWhen the browser redirects to localhost, copy the FULL callback URL and paste it here.");
  console.log("If localhost does not load, that is fine — just copy the address bar.\n");

  const rl = readline.createInterface({ input, output });
  try {
    const pasted = await rl.question("Callback URL (or raw code): ");
    const { code, state: returnedState } = parseAuthorizationInput(pasted);
    if (!code) {
      throw new Error("No authorization code found in pasted input");
    }
    if (returnedState && returnedState !== state) {
      throw new Error("OAuth state mismatch");
    }

    const credentials = await exchangeAuthorizationCode({ code, verifier });
    await writeCredentials(credentials, credentialsFile);

    console.log(`\nLogin successful. Credentials saved to ${credentialsFile}`);
    console.log(`Account ID: ${credentials.account_id}`);
    console.log(`Expires at: ${new Date(credentials.expires_at).toISOString()}\n`);
  } finally {
    rl.close();
  }
}
