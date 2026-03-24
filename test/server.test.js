import test from "node:test";
import assert from "node:assert/strict";

import { resolveSessionId } from "../src/server.js";

test("resolveSessionId uses a valid explicit prompt_cache_key", () => {
  const req = { headers: {} };
  const requestBody = {
    prompt_cache_key: "session-123",
    user: "user-123",
  };

  assert.equal(resolveSessionId(req, requestBody), "session-123");
});

test("resolveSessionId ignores invalid prompt_cache_key values", () => {
  const req = { headers: {} };
  const requestBody = {
    prompt_cache_key: "x".repeat(65),
    user: "user-123",
  };

  assert.equal(resolveSessionId(req, requestBody), "user-123");
});
