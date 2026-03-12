import http from "node:http";

const PORT = Number.parseInt(process.env.MOCK_CODEX_PORT || "18080", 10);
const MODE = process.env.MOCK_CODEX_MODE || "text";
const HOST = process.env.MOCK_CODEX_HOST || "127.0.0.1";

function sendSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function latestUserText(input = []) {
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (item?.role !== "user" || !Array.isArray(item.content)) continue;
    const text = item.content
      .filter((part) => part?.type === "input_text")
      .map((part) => part.text || "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "hello";
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: MODE }));
    return;
  }

  if (req.method !== "POST" || !url.pathname.endsWith("/codex/responses")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const body = await parseBody(req);
  const model = body.model || "gpt-5.4";
  const responseId = `resp_mock_${Date.now()}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  sendSSE(res, {
    type: "response.created",
    sequence_number: 1,
    response: {
      id: responseId,
      model,
      status: "in_progress",
    },
  });

  if (MODE === "tool" || (MODE === "auto" && Array.isArray(body.tools) && body.tools.length > 0)) {
    const tool = body.tools?.[0] || { name: "mock_tool" };
    const item = {
      id: "fc_mock_1",
      type: "function_call",
      call_id: "call_mock_1",
      name: tool.name,
      arguments: "",
      status: "in_progress",
    };

    sendSSE(res, {
      type: "response.output_item.added",
      sequence_number: 2,
      output_index: 0,
      item,
    });

    const args = '{"query":"weather tokyo"}';
    sendSSE(res, {
      type: "response.function_call_arguments.delta",
      sequence_number: 3,
      output_index: 0,
      item_id: item.id,
      delta: args.slice(0, 10),
    });
    sendSSE(res, {
      type: "response.function_call_arguments.delta",
      sequence_number: 4,
      output_index: 0,
      item_id: item.id,
      delta: args.slice(10),
    });
    sendSSE(res, {
      type: "response.function_call_arguments.done",
      sequence_number: 5,
      output_index: 0,
      item_id: item.id,
      name: tool.name,
      arguments: args,
    });
    sendSSE(res, {
      type: "response.output_item.done",
      sequence_number: 6,
      output_index: 0,
      item: {
        ...item,
        arguments: args,
        status: "completed",
      },
    });
    sendSSE(res, {
      type: "response.completed",
      sequence_number: 7,
      response: {
        id: responseId,
        model,
        status: "completed",
        usage: {
          input_tokens: 12,
          output_tokens: 6,
        },
      },
    });
    res.end();
    return;
  }

  const text = `Mock Codex reply: ${latestUserText(body.input)}`;
  const item = {
    id: "msg_mock_1",
    type: "message",
    role: "assistant",
    status: "in_progress",
    content: [
      {
        type: "output_text",
        text: "",
        annotations: [],
      },
    ],
  };

  sendSSE(res, {
    type: "response.output_item.added",
    sequence_number: 2,
    output_index: 0,
    item,
  });

  const halfway = Math.max(1, Math.floor(text.length / 2));
  sendSSE(res, {
    type: "response.output_text.delta",
    sequence_number: 3,
    output_index: 0,
    content_index: 0,
    item_id: item.id,
    delta: text.slice(0, halfway),
    logprobs: [],
  });
  sendSSE(res, {
    type: "response.output_text.delta",
    sequence_number: 4,
    output_index: 0,
    content_index: 0,
    item_id: item.id,
    delta: text.slice(halfway),
    logprobs: [],
  });
  sendSSE(res, {
    type: "response.output_item.done",
    sequence_number: 5,
    output_index: 0,
    item: {
      ...item,
      status: "completed",
      content: [
        {
          type: "output_text",
          text,
          annotations: [],
        },
      ],
    },
  });
  sendSSE(res, {
    type: "response.completed",
    sequence_number: 6,
    response: {
      id: responseId,
      model,
      status: "completed",
      usage: {
        input_tokens: 10,
        output_tokens: text.length,
      },
    },
  });
  res.end();
});

server.listen(PORT, HOST, () => {
  console.log(`mock-codex listening on http://${HOST}:${PORT} (${MODE})`);
});
