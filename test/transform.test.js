import test from "node:test";
import assert from "node:assert/strict";

import { buildResponsesResponse, chatCompletionsToCodexBody } from "../src/transform.js";

test("does not derive prompt_cache_key from user values", () => {
  const user = "user-".repeat(30);
  const requestBody = {
    model: "gpt-5.4",
    user,
    messages: [{ role: "user", content: "hello" }],
  };

  const body = chatCompletionsToCodexBody(requestBody);

  assert.equal(body.prompt_cache_key, undefined);

  const response = buildResponsesResponse({
    id: "resp_test",
    createdAt: 1,
    model: "gpt-5.4",
    outputItems: [],
    outputText: "",
    requestBody,
  });

  assert.equal(response.prompt_cache_key, undefined);
});

test("preserves explicit prompt_cache_key values", () => {
  const requestBody = {
    prompt_cache_key: "session-123",
    messages: [{ role: "user", content: "hello" }],
  };

  const body = chatCompletionsToCodexBody(requestBody);

  assert.equal(body.prompt_cache_key, "session-123");
});

test("drops invalid explicit prompt_cache_key values", () => {
  const requestBody = {
    prompt_cache_key: "x".repeat(65),
    messages: [{ role: "user", content: "hello" }],
  };

  const body = chatCompletionsToCodexBody(requestBody);

  assert.equal(body.prompt_cache_key, undefined);

  const response = buildResponsesResponse({
    id: "resp_test",
    createdAt: 1,
    model: "gpt-5.4",
    outputItems: [],
    outputText: "",
    requestBody,
  });

  assert.equal(response.prompt_cache_key, undefined);
});
