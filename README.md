# codex-openai-bridge

A thin OpenAI-compatible bridge for the ChatGPT Codex backend.

It exposes:
- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`

Internally it translates OpenAI-compatible requests into ChatGPT Codex `responses` requests sent to:
- `https://chatgpt.com/backend-api/codex/responses`

## What this is for

Typical deployment shape:

```text
App / Tooling -> LiteLLM -> codex-openai-bridge -> ChatGPT Codex backend
```

LiteLLM can treat this bridge as a normal OpenAI-compatible upstream.

## Features

- Interactive OAuth login inside container (`login` command)
- Stores `access_token`, `refresh_token`, `expires_at`, `account_id` in `/data/credentials.json`
- Auto refresh on expiry
- Supports streamed and non-streamed `chat/completions`
- Supports streamed and non-streamed `responses`
- Basic tool call translation (`tools`, `tool_choice`, tool-call deltas)
- Optional inbound API key guard with `BRIDGE_API_KEY`
- GitHub Actions workflow for automatic multi-arch Docker builds (`linux/amd64`, `linux/arm64`) to GHCR

## Files

```text
src/cli.js                   CLI entrypoint (`server`, `login`, `whoami`, `import`)
src/server.js                HTTP bridge
src/oauth.js                 manual paste OAuth flow
src/codex-client.js          upstream Codex client
src/transform.js             OpenAI <-> Codex translation
.github/workflows/docker.yml multi-arch Docker build workflow
Dockerfile                   container image
```

## Environment

| Variable | Default | Meaning |
|---|---:|---|
| `PORT` | `8088` | HTTP listen port |
| `DATA_DIR` | `/data` | credential storage directory |
| `CREDENTIALS_FILE` | `<DATA_DIR>/credentials.json` | credential file path |
| `CODEX_BASE_URL` | `https://chatgpt.com/backend-api` | upstream base URL |
| `CODEX_BRIDGE_MODELS` | built-in list | comma-separated models exposed by `/v1/models` |
| `CODEX_DEFAULT_MODEL` | first model | default model fallback |
| `BRIDGE_API_KEY` | empty | optional inbound Bearer token required by the bridge |
| `CODEX_TEXT_VERBOSITY` | `medium` | upstream text verbosity |
| `CODEX_REASONING_EFFORT` | empty | optional upstream reasoning effort |
| `CODEX_REASONING_SUMMARY` | `auto` | optional upstream reasoning summary |
| `CODEX_ORIGINATOR` | `codex-bridge` | upstream `originator` header |

## Build

```bash
podman build -t localhost/local/codex-openai-bridge:dev .
# or
# docker build -t codex-openai-bridge:dev .
```

## Run

```bash
podman run -d \
  --name codex-bridge \
  -p 8088:8088 \
  -v ./data:/data:Z \
  localhost/local/codex-openai-bridge:dev
```

## Interactive login inside container

Use a running container and paste the final browser callback URL back into the prompt:

```bash
podman exec -it codex-bridge node src/cli.js login
```

What happens:
1. Container prints an OpenAI auth URL
2. You open it in your host browser
3. After login, browser redirects to something like:
   `http://localhost:1455/auth/callback?code=...&state=...`
4. Copy the **full** callback URL from the address bar
5. Paste it into the container prompt
6. Credentials are stored in `/data/credentials.json`

If the localhost page does not actually load, that is still okay. The address bar URL is what matters.

## Check stored account

```bash
podman exec -it codex-bridge node src/cli.js whoami
```

## Example smoke tests

### Chat Completions

```bash
curl http://127.0.0.1:8088/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-5.4",
    "messages": [{"role": "user", "content": "hello"}]
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

## GitHub Actions Docker publishing

This repository includes `.github/workflows/docker.yml`.

On pushes to `main` (and `v*` tags), GitHub Actions will build a multi-arch image for:
- `linux/amd64`
- `linux/arm64`

and publish it to:

```text
ghcr.io/<owner>/<repo>
```

For this repository that becomes:

```text
ghcr.io/leespo/codex-api-bridge
```

## Notes

- This is built for personal/self-hosted use.
- Upstream Codex is not a stable public OpenAI Platform endpoint; expect breakage when OpenAI changes headers/events/fields.
- Tool support is intentionally minimal but usable for LiteLLM-style chat-completions and responses flows.
- Several OpenAI-style compatibility fields are accepted but currently dropped before forwarding because the ChatGPT-backed Codex upstream rejects them explicitly. This currently includes token-cap fields (`max_tokens`, `max_completion_tokens`, `max_output_tokens`) and sampling fields (`temperature`, `top_p`, `presence_penalty`, `frequency_penalty`).
