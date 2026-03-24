import http from "node:http";
import { getValidCredentials } from "./credentials.js";
import { startCodexRequest } from "./codex-client.js";
import { DEFAULT_PORT } from "./constants.js";
import { parseSSE, writeSSE, writeSSEDone } from "./sse.js";
import {
  buildResponsesResponse,
  chatCompletionsToCodexBody,
  createAccumulator,
  createChatCompletionChunk,
  createChatCompletionResponse,
  createResponsesAccumulator,
  finishReasonFromAccumulator,
  handleCodexEventForAccumulation,
  handleCodexEventForResponses,
  responsesToCodexBody,
  toolCallsForChatCompletion,
  usageFromCodexResponse,
  validatePromptCacheKey,
} from "./transform.js";
import { getBridgeApiKey, getCredentialsPath, getDefaultModel, getListenPort, getModels, shortError } from "./utils.js";

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendOpenAIError(res, statusCode, message, type = "invalid_request_error", code = null) {
  return sendJson(res, statusCode, {
    error: {
      message,
      type,
      code,
    },
  });
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requestPath(req) {
  return new URL(req.url || "/", "http://localhost").pathname;
}

function requireBridgeAuth(req, res) {
  const expected = getBridgeApiKey();
  if (!expected) return true;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    sendOpenAIError(res, 401, "Invalid bridge API key", "authentication_error", "invalid_api_key");
    return false;
  }
  return true;
}

function modelListResponse() {
  const now = Math.floor(Date.now() / 1000);
  return {
    object: "list",
    data: getModels().map((id) => ({
      id,
      object: "model",
      created: now,
      owned_by: "openai-codex",
    })),
  };
}

async function healthResponse() {
  const credentialsFile = getCredentialsPath();
  try {
    const credentials = await getValidCredentials(credentialsFile);
    return {
      ok: true,
      service: "codex-openai-bridge",
      credentials_file: credentialsFile,
      authenticated: true,
      account_id: credentials.account_id,
      expires_at: credentials.expires_at,
      default_model: getDefaultModel(),
      models: getModels(),
    };
  } catch (error) {
    return {
      ok: true,
      service: "codex-openai-bridge",
      credentials_file: credentialsFile,
      authenticated: false,
      auth_error: shortError(error),
      default_model: getDefaultModel(),
      models: getModels(),
    };
  }
}

async function handleHealth(_req, res) {
  sendJson(res, 200, await healthResponse());
}

async function handleModels(_req, res) {
  sendJson(res, 200, modelListResponse());
}

function writeChatChunk(res, acc, delta = {}, finishReason = null) {
  writeSSE(
    res,
    createChatCompletionChunk({
      id: acc.id,
      model: acc.model,
      created: acc.created,
      delta,
      finishReason,
    }),
  );
}

function writeEventStreamHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

export function resolveSessionId(req, requestBody) {
  return (
    req.headers["x-session-id"] ||
    validatePromptCacheKey(requestBody?.prompt_cache_key) ||
    requestBody?.user ||
    requestBody?.previous_response_id ||
    undefined
  );
}

async function streamChatCompletion(res, upstreamResponse, requestBody) {
  const acc = createAccumulator({ requestedModel: requestBody.model });

  writeEventStreamHeaders(res);

  for await (const event of parseSSE(upstreamResponse)) {
    const result = handleCodexEventForAccumulation(acc, event);

    if (result.failed) {
      writeChatChunk(res, acc, {}, finishReasonFromAccumulator(acc));
      writeSSEDone(res);
      res.end();
      return;
    }

    if (result.textDelta) {
      const delta = { content: result.textDelta };
      if (!acc.roleSent) {
        delta.role = "assistant";
        acc.roleSent = true;
      }
      writeChatChunk(res, acc, delta, null);
    }

    if (result.toolCallAdded) {
      const delta = {
        tool_calls: [
          {
            index: result.toolCallAdded.index,
            id: result.toolCallAdded.id,
            type: "function",
            function: {
              name: result.toolCallAdded.function.name,
              arguments: result.toolCallAdded.function.arguments || "",
            },
          },
        ],
      };
      if (!acc.roleSent) {
        delta.role = "assistant";
        acc.roleSent = true;
      }
      writeChatChunk(res, acc, delta, null);
    }

    if (result.toolCallArgumentsDelta && result.argumentsDelta) {
      writeChatChunk(
        res,
        acc,
        {
          tool_calls: [
            {
              index: result.toolCallArgumentsDelta.index,
              function: {
                arguments: result.argumentsDelta,
              },
            },
          ],
        },
        null,
      );
    }

    if (result.done) {
      if (!acc.roleSent) {
        writeChatChunk(res, acc, { role: "assistant" }, null);
        acc.roleSent = true;
      }
      writeChatChunk(res, acc, {}, finishReasonFromAccumulator(acc));
      writeSSEDone(res);
      res.end();
      return;
    }
  }

  if (!res.writableEnded) {
    writeChatChunk(res, acc, {}, finishReasonFromAccumulator(acc));
    writeSSEDone(res);
    res.end();
  }
}

async function nonStreamChatCompletion(res, upstreamResponse, requestBody) {
  const acc = createAccumulator({ requestedModel: requestBody.model });

  for await (const event of parseSSE(upstreamResponse)) {
    const result = handleCodexEventForAccumulation(acc, event);
    if (result.failed) {
      throw new Error(result.error || "Codex response failed");
    }
  }

  const payload = createChatCompletionResponse({
    id: acc.id,
    model: acc.model,
    created: acc.created,
    content: acc.content,
    toolCalls: toolCallsForChatCompletion(acc),
    finishReason: finishReasonFromAccumulator(acc),
    usage: usageFromCodexResponse(acc.response),
  });

  sendJson(res, 200, payload);
}

async function streamResponses(res, upstreamResponse, requestBody) {
  const acc = createResponsesAccumulator({ requestedModel: requestBody.model, requestBody });

  writeEventStreamHeaders(res);

  for await (const rawEvent of parseSSE(upstreamResponse)) {
    const result = handleCodexEventForResponses(acc, rawEvent);
    if (result.event) {
      writeSSE(res, result.event);
    }
    if (result.done) {
      res.end();
      return;
    }
  }

  if (!res.writableEnded) {
    res.end();
  }
}

async function nonStreamResponses(res, upstreamResponse, requestBody) {
  const acc = createResponsesAccumulator({ requestedModel: requestBody.model, requestBody });

  for await (const rawEvent of parseSSE(upstreamResponse)) {
    const result = handleCodexEventForResponses(acc, rawEvent);
    if (result.failed) {
      throw acc.error || new Error("Codex response failed");
    }
  }

  if (acc.error) {
    throw acc.error;
  }

  sendJson(res, 200, buildResponsesResponse(acc));
}

async function handleChatCompletions(req, res) {
  if (!requireBridgeAuth(req, res)) return;

  let requestBody;
  try {
    requestBody = await parseJsonBody(req);
  } catch (error) {
    return sendOpenAIError(res, 400, `Invalid JSON body: ${shortError(error)}`);
  }

  if (!Array.isArray(requestBody?.messages)) {
    return sendOpenAIError(res, 400, "messages must be an array");
  }

  const stream = Boolean(requestBody.stream);
  const codexBody = chatCompletionsToCodexBody(requestBody);
  const sessionId = resolveSessionId(req, requestBody);

  try {
    const upstreamResponse = await startCodexRequest({
      body: codexBody,
      credentialsFile: getCredentialsPath(),
      sessionId: sessionId ? String(sessionId) : undefined,
    });

    if (stream) {
      await streamChatCompletion(res, upstreamResponse, requestBody);
      return;
    }

    await nonStreamChatCompletion(res, upstreamResponse, requestBody);
  } catch (error) {
    if (!res.headersSent) {
      return sendOpenAIError(res, 503, shortError(error), "api_error", "codex_upstream_error");
    }
    if (!res.writableEnded) res.end();
  }
}

async function handleResponses(req, res) {
  if (!requireBridgeAuth(req, res)) return;

  let requestBody;
  try {
    requestBody = await parseJsonBody(req);
  } catch (error) {
    return sendOpenAIError(res, 400, `Invalid JSON body: ${shortError(error)}`);
  }

  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return sendOpenAIError(res, 400, "request body must be a JSON object");
  }

  const stream = Boolean(requestBody.stream);
  const codexBody = responsesToCodexBody(requestBody);
  const sessionId = resolveSessionId(req, requestBody);

  try {
    const upstreamResponse = await startCodexRequest({
      body: codexBody,
      credentialsFile: getCredentialsPath(),
      sessionId: sessionId ? String(sessionId) : undefined,
    });

    if (stream) {
      await streamResponses(res, upstreamResponse, requestBody);
      return;
    }

    await nonStreamResponses(res, upstreamResponse, requestBody);
  } catch (error) {
    if (!res.headersSent) {
      return sendOpenAIError(res, 503, shortError(error), "api_error", "codex_upstream_error");
    }
    if (!res.writableEnded) res.end();
  }
}

async function handleRequest(req, res) {
  const pathname = requestPath(req);

  if (req.method === "GET" && pathname === "/healthz") {
    return handleHealth(req, res);
  }

  if (req.method === "GET" && pathname === "/v1/models") {
    return handleModels(req, res);
  }

  if (req.method === "GET" && pathname === "/") {
    return sendJson(res, 200, {
      ok: true,
      service: "codex-openai-bridge",
      endpoints: ["GET /healthz", "GET /v1/models", "POST /v1/chat/completions", "POST /v1/responses"],
    });
  }

  if (req.method === "POST" && pathname === "/v1/chat/completions") {
    return handleChatCompletions(req, res);
  }

  if (req.method === "POST" && pathname === "/v1/responses") {
    return handleResponses(req, res);
  }

  return sendOpenAIError(res, 404, `Route not found: ${req.method} ${pathname}`, "invalid_request_error", "not_found");
}

export function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      console.error("Unhandled request error:", error);
      if (!res.headersSent) {
        sendOpenAIError(res, 500, shortError(error), "server_error", "internal_error");
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });
}

export async function runServer() {
  const port = getListenPort() || DEFAULT_PORT;
  const server = createServer();

  await new Promise((resolve) => server.listen(port, "0.0.0.0", resolve));
  console.log(`codex-openai-bridge listening on http://0.0.0.0:${port}`);
  console.log(`credentials file: ${getCredentialsPath()}`);
  console.log(`models: ${getModels().join(", ")}`);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
