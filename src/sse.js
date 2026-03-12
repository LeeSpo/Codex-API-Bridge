export async function* parseSSE(response) {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLines = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      if (dataLines.length > 0) {
        const data = dataLines.join("\n").trim();
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data);
          } catch {
            // ignore malformed chunks
          }
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function writeSSE(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeSSEDone(res) {
  res.write("data: [DONE]\n\n");
}
