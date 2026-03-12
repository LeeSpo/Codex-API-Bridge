# Codex API Bridge

A thin OpenAI-compatible bridge for the ChatGPT-backed Codex backend.

It exposes:
- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

Internally it translates OpenAI-compatible requests into Codex `responses` requests sent to:

- `https://chatgpt.com/backend-api/codex/responses`

---

## What this is for

Typical deployment shape:

```text
App / Tooling -> LiteLLM -> Codex API Bridge -> ChatGPT Codex backend
```

This project is meant for self-hosted / personal use when you want to expose Codex behind an OpenAI-compatible API surface.

---

## Features

- Interactive OAuth login inside the container (`login` command)
- Stores `access_token`, `refresh_token`, `expires_at`, `account_id` in `/data/credentials.json`
- Auto refresh on expiry
- Supports streamed and non-streamed `chat/completions`
- Supports streamed and non-streamed `responses`
- Basic tool-call translation (`tools`, `tool_choice`, tool-call deltas)
- Optional inbound API key guard with `BRIDGE_API_KEY`
- GitHub Actions workflow for automatic multi-arch Docker builds to GHCR:
  - `linux/amd64`
  - `linux/arm64`

---

## Verified models

Verified against a real ChatGPT/Codex-backed upstream on a ChatGPT account:

- `gpt-5.4`
- `gpt-5.3-codex`
- `gpt-5.2-codex`
- `gpt-5.2`
- `gpt-5.1`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`

Currently **not supported on ChatGPT accounts**:

- `gpt-5.3-codex-spark`

---

## Quick start with Docker

### 1. Pull the image

```bash
docker pull ghcr.io/leespo/codex-api-bridge:latest
```

### 2. Create a data directory

```bash
mkdir -p ~/codex-api-bridge/data
cd ~/codex-api-bridge
```

### 3. Run the container

```bash
docker run -d \
  --name codex-bridge \
  -p 8088:8088 \
  -v "$(pwd)/data:/data" \
  ghcr.io/leespo/codex-api-bridge:latest
```

### 4. Login inside the container

```bash
docker exec -it codex-bridge node src/cli.js login
```

What happens:
1. The container prints an OpenAI auth URL
2. Open it in your browser
3. After login, the browser redirects to something like:
   `http://localhost:1455/auth/callback?code=...&state=...`
4. Copy the **full** callback URL from the address bar
5. Paste it back into the terminal prompt
6. Credentials are stored in `/data/credentials.json`

If the localhost page itself does not load, that is still okay. The address bar URL is what matters.

### 5. Check login state

```bash
docker exec -it codex-bridge node src/cli.js whoami
curl http://127.0.0.1:8088/healthz
```

---

## Quick start with Podman

### 1. Pull the image

```bash
podman pull ghcr.io/leespo/codex-api-bridge:latest
```

### 2. Run the container

```bash
mkdir -p ~/codex-api-bridge/data
cd ~/codex-api-bridge

podman run -d \
  --name codex-bridge \
  -p 8088:8088 \
  -v "$(pwd)/data:/data:Z" \
  ghcr.io/leespo/codex-api-bridge:latest
```

### 3. Login

```bash
podman exec -it codex-bridge node src/cli.js login
```

---

## Example requests

### Chat Completions

```bash
curl http://127.0.0.1:8088/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {"role": "user", "content": "hello"}
    ]
  }'
```

### Responses API

```bash
curl http://127.0.0.1:8088/v1/responses \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "input": "hello"
  }'
```

### Streamed Responses API

```bash
curl -N http://127.0.0.1:8088/v1/responses \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "stream": true,
    "input": "hello"
  }'
```

---

## LiteLLM integration

### Recommended model config

```yaml
model_list:
  - model_name: codex-gpt-5-4
    litellm_params:
      model: openai/gpt-5.4
      api_base: http://codex-bridge:8088/v1
      api_key: dummy
```

### Important notes for LiteLLM

- Use the `openai/` prefix in the model name when configuring an OpenAI-compatible upstream.
- For OpenAI-compatible routing, `api_base` should point at this bridge and typically end with `/v1`.
- If LiteLLM and `codex-bridge` are running in separate containers, make sure they are on the **same user-defined Docker network**.
- If LiteLLM's UI **Test Connection** shows a strange cURL example, do not trust that rendered cURL literally. LiteLLM performs the real health check server-side.

### Same-network Docker example

```bash
docker network create ai-net

docker run -d \
  --name codex-bridge \
  --network ai-net \
  -p 8088:8088 \
  -v "$(pwd)/data:/data" \
  ghcr.io/leespo/codex-api-bridge:latest
```

Then LiteLLM can use:

```text
http://codex-bridge:8088/v1
```

---

## Environment variables

| Variable | Default | Meaning |
|---|---:|---|
| `PORT` | `8088` | HTTP listen port |
| `DATA_DIR` | `/data` | Credential storage directory |
| `CREDENTIALS_FILE` | `<DATA_DIR>/credentials.json` | Credential file path |
| `CODEX_BASE_URL` | `https://chatgpt.com/backend-api` | Upstream base URL |
| `CODEX_BRIDGE_MODELS` | built-in list | Comma-separated models exposed by `/v1/models` |
| `CODEX_DEFAULT_MODEL` | first model | Default model fallback |
| `BRIDGE_API_KEY` | empty | Optional inbound Bearer token required by the bridge |
| `CODEX_TEXT_VERBOSITY` | `medium` | Upstream text verbosity |
| `CODEX_REASONING_EFFORT` | empty | Optional upstream reasoning effort |
| `CODEX_REASONING_SUMMARY` | `auto` | Optional upstream reasoning summary |
| `CODEX_ORIGINATOR` | `codex-bridge` | Upstream `originator` header |

---

## Docker publishing

This repository includes:

- `.github/workflows/docker.yml`

On pushes to `main` and tags matching `v*`, GitHub Actions builds a multi-arch image for:

- `linux/amd64`
- `linux/arm64`

and publishes it to:

```text
ghcr.io/leespo/codex-api-bridge
```

---

## Local development

### Build locally

```bash
docker build -t codex-api-bridge:dev .
# or
podman build -t localhost/local/codex-openai-bridge:dev .
```

### Run local dev image

```bash
docker run -d \
  --name codex-bridge \
  -p 8088:8088 \
  -v "$(pwd)/data:/data" \
  codex-api-bridge:dev
```

### Mock upstream server

```bash
node test/mock-codex-server.js
```

---

## Files

```text
src/cli.js
src/server.js
src/oauth.js
src/codex-client.js
src/transform.js
src/sse.js
src/credentials.js
.github/workflows/docker.yml
Dockerfile
```

---

## Notes and limitations

- This is built for personal / self-hosted use.
- Upstream Codex is not a stable public OpenAI Platform endpoint. Expect breakage when OpenAI changes headers, events, or request fields.
- Tool support is intentionally minimal but usable for LiteLLM-style chat-completions and responses flows.
- Several OpenAI-style compatibility fields are currently **accepted by the bridge but dropped before forwarding** because the ChatGPT-backed Codex upstream rejects them explicitly.

This currently includes:

- token-cap fields:
  - `max_tokens`
  - `max_completion_tokens`
  - `max_output_tokens`
- sampling / penalty fields:
  - `temperature`
  - `top_p`
  - `presence_penalty`
  - `frequency_penalty`

The bridge focuses on text/chat/responses compatibility first. It is **not** a full implementation of the entire OpenAI API surface.
