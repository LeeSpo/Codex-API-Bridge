import { getDefaultModel, nowUnix, toPlainText } from "./utils.js";

const CODEX_RESPONSE_STATUSES = new Set([
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "queued",
  "in_progress",
]);

function textPart(text) {
  return {
    type: "output_text",
    text,
    annotations: [],
  };
}

function userTextPart(text) {
  return {
    type: "input_text",
    text,
  };
}

function userImagePart(imageUrl, detail = "auto") {
  return {
    type: "input_image",
    image_url: imageUrl,
    detail,
  };
}

function normalizeCodexStatus(status) {
  if (typeof status !== "string") return undefined;
  return CODEX_RESPONSE_STATUSES.has(status) ? status : undefined;
}

function mergeInclude(existing = [], extra = []) {
  const merged = new Set();
  for (const value of [...(Array.isArray(existing) ? existing : []), ...extra]) {
    if (typeof value === "string" && value.trim()) {
      merged.add(value.trim());
    }
  }
  return [...merged];
}

function responseOutputContentToText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "output_text") return part.text || "";
      if (part.type === "refusal") return part.refusal || "";
      if (part.type === "text") return part.text || "";
      return "";
    })
    .join("");
}

function openAIContentToCodexInput(content) {
  if (content == null) return [];
  if (typeof content === "string") {
    return content ? [userTextPart(content)] : [];
  }

  if (!Array.isArray(content)) {
    return [userTextPart(String(content))];
  }

  const parts = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === "string") {
      parts.push(userTextPart(part));
      continue;
    }
    if (part.type === "text") {
      parts.push(userTextPart(part.text || ""));
      continue;
    }
    if (part.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (url) {
        parts.push(userImagePart(url, part.image_url?.detail || "auto"));
      }
      continue;
    }
    if (part.type === "input_text") {
      parts.push(userTextPart(part.text || ""));
      continue;
    }
    if (part.type === "input_image") {
      if (part.image_url) {
        parts.push(userImagePart(part.image_url, part.detail || "auto"));
      }
      continue;
    }
  }
  return parts;
}

function assistantTextToCodexMessage(text, index) {
  return {
    type: "message",
    id: `msg_${index}`,
    role: "assistant",
    status: "completed",
    content: [textPart(text)],
  };
}

function normalizeToolChoice(toolChoice) {
  if (toolChoice == null) return "auto";
  if (typeof toolChoice === "string") return toolChoice;
  if (toolChoice.type === "function") {
    return {
      type: "function",
      name: toolChoice.function?.name || toolChoice.name,
    };
  }
  return toolChoice;
}

function normalizeTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => {
    if (tool?.type === "function" && tool.function?.name) {
      return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters || { type: "object", properties: {} },
        strict: tool.function.strict ?? null,
      };
    }
    return tool;
  });
}

function maybePushUserInput(input, content) {
  if (Array.isArray(content) && content.length > 0) {
    input.push({ role: "user", content });
  }
}

function normalizeResponseInput(input, instructionsParts = []) {
  if (input == null) return [];

  const items = Array.isArray(input) ? input : [input];
  const normalized = [];
  let assistantIndex = 0;

  for (const item of items) {
    if (item == null) continue;

    if (typeof item === "string") {
      maybePushUserInput(normalized, [userTextPart(item)]);
      continue;
    }

    if (typeof item !== "object") {
      maybePushUserInput(normalized, [userTextPart(String(item))]);
      continue;
    }

    if (item.type === "function_call_output") {
      normalized.push({
        type: "function_call_output",
        call_id: item.call_id,
        output: typeof item.output === "string" ? item.output : toPlainText(item.output),
      });
      continue;
    }

    if (item.type === "function_call") {
      normalized.push({
        type: "function_call",
        id: item.id,
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments || "{}",
        status: item.status,
      });
      continue;
    }

    if (item.type === "message" && item.role === "assistant") {
      const assistantText = responseOutputContentToText(item.content);
      if (assistantText) {
        normalized.push(assistantTextToCodexMessage(assistantText, assistantIndex++));
      }
      continue;
    }

    if (item.type === "message" && item.role === "user") {
      maybePushUserInput(normalized, openAIContentToCodexInput(item.content));
      continue;
    }

    if (item.type === "reasoning") {
      normalized.push(item);
      continue;
    }

    const role = item.role;
    if (role === "system" || role === "developer") {
      const text = toPlainText(item.content);
      if (text) instructionsParts.push(text);
      continue;
    }

    if (role === "user") {
      maybePushUserInput(normalized, openAIContentToCodexInput(item.content));
      continue;
    }

    if (role === "assistant") {
      const assistantText = toPlainText(item.content);
      if (assistantText) {
        normalized.push(assistantTextToCodexMessage(assistantText, assistantIndex++));
      }

      const toolCalls = Array.isArray(item.tool_calls) ? item.tool_calls : [];
      for (const toolCall of toolCalls) {
        if (toolCall?.type !== "function") continue;
        normalized.push({
          type: "function_call",
          call_id: toolCall.id || `call_${assistantIndex}_${normalized.length}`,
          name: toolCall.function?.name || "unknown_tool",
          arguments: toolCall.function?.arguments || "{}",
        });
      }
      continue;
    }

    if (role === "tool") {
      normalized.push({
        type: "function_call_output",
        call_id: item.tool_call_id || item.call_id,
        output: toPlainText(item.content) || "",
      });
      continue;
    }

    if (Array.isArray(item.content)) {
      maybePushUserInput(normalized, openAIContentToCodexInput(item.content));
      continue;
    }
  }

  return normalized;
}

function applyCommonCodexDefaults(body, requestBody) {
  body.model = body.model || requestBody?.model || getDefaultModel();
  body.stream = true;
  body.store = requestBody?.store ?? body.store ?? false;
  if (body.instructions === undefined || body.instructions === null) {
    body.instructions = "";
  }
  body.include = mergeInclude(body.include, ["reasoning.encrypted_content"]);
  body.parallel_tool_calls = requestBody?.parallel_tool_calls ?? body.parallel_tool_calls ?? true;
  body.tool_choice = normalizeToolChoice(body.tool_choice ?? requestBody?.tool_choice);

  if (body.tools || requestBody?.tools) {
    body.tools = normalizeTools(body.tools || requestBody.tools);
  }

  if (body.temperature === undefined && requestBody?.temperature !== undefined) {
    body.temperature = requestBody.temperature;
  }

  if (body.top_p === undefined && requestBody?.top_p !== undefined) {
    body.top_p = requestBody.top_p;
  }

  // ChatGPT-backed Codex currently rejects several explicit OpenAI sampling / token-cap
  // fields on the request body. For OpenAI-compatible callers (e.g. LiteLLM), prefer
  // compatibility over strict passthrough and silently drop them on the upstream call.
  delete body.max_output_tokens;
  delete body.max_tokens;
  delete body.max_completion_tokens;
  delete body.temperature;
  delete body.top_p;
  delete body.presence_penalty;
  delete body.frequency_penalty;

  const text = typeof body.text === "object" && body.text !== null ? { ...body.text } : {};
  if (!text.verbosity) {
    text.verbosity = process.env.CODEX_TEXT_VERBOSITY || "medium";
  }
  body.text = text;

  const reasoning = typeof body.reasoning === "object" && body.reasoning !== null ? { ...body.reasoning } : {};
  const reasoningEffort = reasoning.effort || process.env.CODEX_REASONING_EFFORT;
  if (reasoningEffort) {
    reasoning.effort = reasoningEffort;
    reasoning.summary = reasoning.summary || process.env.CODEX_REASONING_SUMMARY || "auto";
    body.reasoning = reasoning;
  } else if (requestBody?.reasoning && Object.keys(requestBody.reasoning).length > 0) {
    body.reasoning = requestBody.reasoning;
  }

  if (!body.prompt_cache_key && requestBody?.user) {
    body.prompt_cache_key = String(requestBody.user);
  }

  return body;
}

export function chatCompletionsToCodexBody(requestBody) {
  const messages = Array.isArray(requestBody?.messages) ? requestBody.messages : [];
  const instructions = [];
  const input = normalizeResponseInput(messages, instructions);

  const body = applyCommonCodexDefaults(
    {
      model: requestBody?.model,
      instructions: instructions.join("\n\n"),
      input,
    },
    requestBody,
  );

  return body;
}

export function responsesToCodexBody(requestBody) {
  const instructions = [];
  let input = normalizeResponseInput(requestBody?.input, instructions);

  if (input.length === 0 && Array.isArray(requestBody?.messages)) {
    input = normalizeResponseInput(requestBody.messages, instructions);
  }

  const body = {
    ...requestBody,
    model: requestBody?.model || getDefaultModel(),
    input,
  };

  if (requestBody?.instructions !== undefined && requestBody?.instructions !== null) {
    body.instructions = requestBody.instructions;
  } else if (instructions.length > 0) {
    body.instructions = instructions.join("\n\n");
  }

  return applyCommonCodexDefaults(body, requestBody);
}

export function normalizeCodexEvent(event) {
  if (!event || typeof event !== "object") return null;

  if (event.type === "response.done" || event.type === "response.completed") {
    const response = event.response
      ? { ...event.response, status: normalizeCodexStatus(event.response.status) || event.response.status }
      : event.response;
    return {
      ...event,
      type: "response.completed",
      response,
    };
  }

  if (event.response?.status) {
    return {
      ...event,
      response: {
        ...event.response,
        status: normalizeCodexStatus(event.response.status) || event.response.status,
      },
    };
  }

  return event;
}

export function createChatCompletionChunk({ id, model, created, delta = {}, finishReason = null, index = 0 }) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

export function createChatCompletionResponse({ id, model, created, content, toolCalls, finishReason, usage }) {
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: toolCalls.length > 0 ? (content || null) : (content || ""),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

export function usageFromCodexResponse(response) {
  const usage = response?.usage || {};
  const input = Number(usage.input_tokens || usage.input || 0);
  const output = Number(usage.output_tokens || usage.output || 0);
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: Number(usage.total_tokens || input + output),
  };
}

export function createAccumulator({ requestedModel }) {
  const created = nowUnix();
  const id = `chatcmpl_${Math.random().toString(36).slice(2, 12)}`;
  return {
    id,
    created,
    model: requestedModel || getDefaultModel(),
    roleSent: false,
    content: "",
    toolCallsByItemId: new Map(),
    toolCallOrder: [],
    response: null,
  };
}

export function registerToolCall(acc, item, outputIndex = 0) {
  const itemId = item?.id || `item_${outputIndex}`;
  if (acc.toolCallsByItemId.has(itemId)) {
    return acc.toolCallsByItemId.get(itemId);
  }

  const toolCall = {
    index: acc.toolCallOrder.length,
    id: item?.call_id || itemId,
    type: "function",
    function: {
      name: item?.name || "unknown_tool",
      arguments: item?.arguments || "",
    },
    itemId,
  };

  acc.toolCallsByItemId.set(itemId, toolCall);
  acc.toolCallOrder.push(toolCall);
  return toolCall;
}

export function handleCodexEventForAccumulation(acc, rawEvent) {
  const event = normalizeCodexEvent(rawEvent);
  if (!event || typeof event !== "object") return { done: false };

  switch (event.type) {
    case "response.created":
      if (event.response?.id) acc.id = event.response.id;
      if (event.response?.model) acc.model = event.response.model;
      return { done: false };

    case "response.output_item.added": {
      const item = event.item;
      if (item?.type === "function_call") {
        const toolCall = registerToolCall(acc, item, event.output_index);
        return { done: false, toolCallAdded: toolCall };
      }
      return { done: false };
    }

    case "response.output_text.delta":
      acc.content += event.delta || "";
      return { done: false, textDelta: event.delta || "" };

    case "response.function_call_arguments.delta": {
      const toolCall = acc.toolCallsByItemId.get(event.item_id);
      if (toolCall) {
        toolCall.function.arguments += event.delta || "";
      }
      return { done: false, toolCallArgumentsDelta: toolCall, argumentsDelta: event.delta || "" };
    }

    case "response.function_call_arguments.done": {
      const toolCall = acc.toolCallsByItemId.get(event.item_id);
      if (toolCall) {
        toolCall.function.name = event.name || toolCall.function.name;
        toolCall.function.arguments = event.arguments || toolCall.function.arguments;
      }
      return { done: false, toolCallDone: toolCall };
    }

    case "response.output_item.done": {
      const item = event.item;
      if (item?.type === "function_call") {
        const toolCall = registerToolCall(acc, item, event.output_index);
        toolCall.function.name = item.name || toolCall.function.name;
        toolCall.function.arguments = item.arguments || toolCall.function.arguments;
        return { done: false, toolCallDone: toolCall };
      }
      return { done: false };
    }

    case "response.completed":
      acc.response = event.response || acc.response;
      return { done: true, response: acc.response };

    case "response.failed":
      return { done: true, failed: true, error: event.response?.error?.message || "Codex response failed", response: event.response };

    case "error":
      return { done: true, failed: true, error: event.message || event.code || "Codex error" };

    default:
      return { done: false };
  }
}

export function finishReasonFromAccumulator(acc) {
  const responseStatus = acc.response?.status;
  if (responseStatus === "incomplete") return "length";
  if (acc.toolCallOrder.length > 0) return "tool_calls";
  return "stop";
}

export function toolCallsForChatCompletion(acc) {
  return acc.toolCallOrder.map(({ index, id, type, function: fn }) => ({
    index,
    id,
    type,
    function: {
      name: fn.name,
      arguments: fn.arguments,
    },
  }));
}

export function createResponsesAccumulator({ requestedModel, requestBody }) {
  return {
    id: `resp_${Math.random().toString(36).slice(2, 12)}`,
    createdAt: nowUnix(),
    model: requestedModel || getDefaultModel(),
    requestBody: requestBody || {},
    response: null,
    outputItems: [],
    outputText: "",
    error: null,
  };
}

function setOutputItem(acc, outputIndex, item) {
  const index = Number.isInteger(outputIndex) ? outputIndex : acc.outputItems.length;
  acc.outputItems[index] = item;
}

export function handleCodexEventForResponses(acc, rawEvent) {
  const event = normalizeCodexEvent(rawEvent);
  if (!event || typeof event !== "object") return { done: false, event: null };

  switch (event.type) {
    case "response.created":
      if (event.response?.id) acc.id = event.response.id;
      if (event.response?.model) acc.model = event.response.model;
      acc.response = { ...(acc.response || {}), ...(event.response || {}) };
      return { done: false, event };

    case "response.output_item.added":
      if (event.item) {
        setOutputItem(acc, event.output_index, event.item);
      }
      return { done: false, event };

    case "response.output_text.delta":
      acc.outputText += event.delta || "";
      return { done: false, event };

    case "response.output_item.done":
      if (event.item) {
        setOutputItem(acc, event.output_index, event.item);
      }
      return { done: false, event };

    case "response.completed":
      acc.response = { ...(acc.response || {}), ...(event.response || {}) };
      return { done: true, event };

    case "response.failed": {
      const message = event.response?.error?.message || "Codex response failed";
      acc.response = { ...(acc.response || {}), ...(event.response || {}) };
      acc.error = new Error(message);
      return { done: true, failed: true, event };
    }

    case "error": {
      const message = event.message || event.code || "Codex error";
      acc.error = new Error(message);
      return { done: true, failed: true, event };
    }

    default:
      return { done: false, event };
  }
}

function responseOutputText(outputItems, fallbackText = "") {
  const text = outputItems
    .filter(Boolean)
    .map((item) => {
      if (item?.type !== "message") return "";
      return responseOutputContentToText(item.content);
    })
    .join("");
  return text || fallbackText || "";
}

export function buildResponsesResponse(acc) {
  const meta = acc.response || {};
  const requestBody = acc.requestBody || {};
  const output = acc.outputItems.filter(Boolean).length > 0 ? acc.outputItems.filter(Boolean) : (Array.isArray(meta.output) ? meta.output : []);
  const status = normalizeCodexStatus(meta.status) || meta.status || (acc.error ? "failed" : "completed");
  const completedAt = meta.completed_at ?? (status === "completed" ? nowUnix() : null);
  const usage = meta.usage
    ? {
        ...meta.usage,
        total_tokens:
          meta.usage.total_tokens ?? Number(meta.usage.input_tokens || 0) + Number(meta.usage.output_tokens || 0),
      }
    : undefined;

  return {
    id: meta.id || acc.id,
    object: "response",
    created_at: meta.created_at || acc.createdAt,
    output_text: meta.output_text ?? responseOutputText(output, acc.outputText),
    error: meta.error ?? (acc.error ? { message: acc.error.message } : null),
    incomplete_details: meta.incomplete_details ?? null,
    instructions: meta.instructions ?? requestBody.instructions ?? null,
    metadata: meta.metadata ?? requestBody.metadata ?? null,
    model: meta.model || acc.model || requestBody.model || getDefaultModel(),
    output,
    parallel_tool_calls: meta.parallel_tool_calls ?? requestBody.parallel_tool_calls ?? true,
    temperature: meta.temperature ?? requestBody.temperature ?? null,
    tool_choice: meta.tool_choice ?? requestBody.tool_choice ?? "auto",
    tools: meta.tools ?? requestBody.tools ?? [],
    top_p: meta.top_p ?? requestBody.top_p ?? null,
    background: meta.background ?? requestBody.background ?? null,
    completed_at: completedAt,
    conversation: meta.conversation ?? requestBody.conversation ?? null,
    max_output_tokens: meta.max_output_tokens ?? null,
    previous_response_id: meta.previous_response_id ?? requestBody.previous_response_id ?? null,
    prompt: meta.prompt ?? requestBody.prompt ?? null,
    prompt_cache_key: meta.prompt_cache_key ?? requestBody.prompt_cache_key ?? requestBody.user ?? undefined,
    prompt_cache_retention: meta.prompt_cache_retention ?? requestBody.prompt_cache_retention ?? null,
    reasoning: meta.reasoning ?? requestBody.reasoning ?? null,
    safety_identifier: meta.safety_identifier ?? requestBody.safety_identifier ?? undefined,
    service_tier: meta.service_tier ?? requestBody.service_tier ?? undefined,
    status,
    text: meta.text ?? requestBody.text ?? null,
    truncation: meta.truncation ?? requestBody.truncation ?? null,
    usage,
    user: meta.user ?? requestBody.user ?? undefined,
  };
}
