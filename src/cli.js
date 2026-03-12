#!/usr/bin/env node
import { readCredentials, writeCredentials } from "./credentials.js";
import { interactiveLogin } from "./oauth.js";
import { runServer } from "./server.js";
import { getCredentialsPath, json, shortError } from "./utils.js";

async function runWhoAmI() {
  const credentials = await readCredentials(getCredentialsPath());
  console.log(json({
    credentials_file: getCredentialsPath(),
    account_id: credentials.account_id,
    expires_at: credentials.expires_at,
    updated_at: credentials.updated_at,
  }));
}

async function runImport() {
  const raw = process.env.CODEX_BRIDGE_IMPORT_JSON;
  if (!raw) {
    throw new Error("Set CODEX_BRIDGE_IMPORT_JSON to a credentials JSON blob first");
  }
  const parsed = JSON.parse(raw);
  await writeCredentials(parsed, getCredentialsPath());
  console.log(`Imported credentials to ${getCredentialsPath()}`);
}

async function main() {
  const command = process.argv[2] || "server";

  if (command === "server") {
    await runServer();
    return;
  }

  if (command === "login") {
    await interactiveLogin({ credentialsFile: getCredentialsPath() });
    return;
  }

  if (command === "whoami") {
    await runWhoAmI();
    return;
  }

  if (command === "import") {
    await runImport();
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Usage:
  node src/cli.js server   # start OpenAI-compatible bridge
  node src/cli.js login    # interactive OAuth login (paste callback URL)
  node src/cli.js whoami   # show stored account info
  node src/cli.js import   # import credentials from CODEX_BRIDGE_IMPORT_JSON`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(shortError(error));
  process.exit(1);
});
