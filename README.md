# llm-wiki-avatar

Talk to your LLM Wiki. You ask a question out loud, and a lip-syncing avatar answers from the wiki in English or
Dutch. A live transcript runs alongside, and commands and code snippets show up on screen instead of being read
aloud.

It implements steps 2 and 3 of [`Voice_Interface for LLM Wiki.md`](./Voice_Interface%20for%20LLM%20Wiki.md) directly
on [LiveKit Agents](https://docs.livekit.io/agents/) for Node, without Open WebUI. Speech recognition and voices run
in the browser. The agent can use a hosted OpenAI-compatible API or local Ollama.

```
Browser (Next.js)                                         agent (Node, @livekit/agents)
  push-to-talk mic ─► Whisper in a Web Worker (WebGPU/WASM)
  transcribed text ──lk.chat──► livekit-server (dev) ◄──►  LLM  hosted API / Ollama + wiki RAG + wiki tools
  reply text ◄──lk.transcription──
  Kokoro (en) / Piper (nl) in a Web Worker ─► speakers + avatar lip-sync
  transcript, sources, answer cards ◄── text streams
  EN / NL selector ──attribute / RPC──►
```

## How it works

- **Wiki.** The agent reads one or more folders of markdown files and indexes them together with BM25. Configure
  all sources, including a single wiki, with `WIKI_SOURCES`. Each source's `index.md` goes
  into the prompt, and on every turn the best matching excerpts are added automatically. The model can also call
  `searchWiki`, `readPage`, `listRecentChanges` and `showOnScreen`. The index updates while you edit the wiki.
- **Voice-first answers.** The model answers in 2–4 spoken sentences. The browser leaves code blocks out of the
  speech and reads inline code, links and markdown in a speakable form. Replies that contain code, and anything sent
  through `showOnScreen`, appear as an answer card. The sources the answer used appear as chips; click one to open
  the page, including `[[wikilinks]]`.
- **Languages.** The EN/NL selector sets the speech recognition language, the voice and the reply language. The
  wiki stays in English. Choosing a language before you start sends it as a participant attribute. Changing it during
  a session sends the `set_language` RPC, and the agent confirms in the new language.
- **Push to talk.** Hold the mic button or the Space bar while you talk, and release it to send. Pressing stops the
  agent if it is still answering (`interrupt` RPC). The recording never leaves the browser: Whisper turns it into
  text there (see *Speech recognition* below), and the text is sent like a typed question. A recording that is
  silent is not sent at all. A ring around the mic button grows with your voice.
- **Speech recognition.** Whisper runs in the browser with [transformers.js](https://huggingface.co/docs/transformers.js),
  in a Web Worker, on the graphics card (WebGPU) or else on the processor (WASM). The **speech settings** page
  (`/settings`, linked from the start screen and the session header) shows what the browser supports and offers
  three multilingual models: Whisper Base, Small and Large v3 Turbo (WebGPU with 16-bit floats only). Download one
  (once; the browser keeps it in Cache Storage), pick the one to use, try it out, and remove models you no longer
  need. The model files come from Hugging Face; the ONNX Runtime WASM files are served by the frontend. Until a
  model is chosen, the mic button links to the settings and typing still works.
- **Voices.** The replies are spoken in the browser too, in a Web Worker: English with
  [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped) (`af_heart` and `am_michael`, on
  WebGPU or WASM) and Dutch with [Piper](https://github.com/rhasspy/piper) (`nl_BE` Nathalie and Rdh, on WASM). The
  pronunciation comes from eSpeak NG compiled to WASM
  ([piper-wasm](https://www.npmjs.com/package/@diffusionstudio/piper-wasm)), served by the frontend. Download the
  voices on the speech settings page and try them there. The agent only writes: the browser speaks its reply sentence
  by sentence while the text streams in. Without a downloaded voice, replies are text only and a notice links to the
  settings. By default the transcript shows a reply along with the voice, a sentence at a time; *Show dialog without
  delay* (on the settings page) shows it as it arrives.
- **Voice and avatar.** A menu (on the start screen and in the header) picks how the agent answers: *Off* (text
  replies only; you can still talk to it), *Voice only* (female or male) or *Voice and avatar* (*female (premium)*
  or *male*). The
  choice is remembered in the browser and applies right away; a reply that is being spoken in another voice is
  stopped and shown in full. Push-to-talk keeps working with every choice.
- **Stop button.** While a reply is spoken, the *Send* button becomes *Stop*. Clicking it silences the voice and the
  avatar right away and shows the full reply in the transcript.
- **Progress status.** Speech recognition and answering can take several seconds, so the UI shows each step:
  *Hearing you…*, *Processing your speech…* and *Preparing an answer…*, with a seconds counter. The status appears
  in the header, as a banner over the avatar, and as a placeholder message in the transcript.
- **Conversation history.** Each conversation in which you said or typed something is saved in the browser
  (`localStorage`, the latest 50), and listed in a sidebar grouped by *Today*, *Yesterday*, *Previous 7 days* and
  month. Click one to read it back, delete it, or *Continue conversation*: the agent then gets the earlier turns
  (the latest ones that fit in 14 KB) through the `restore_history` RPC, so it can refer back to them. History is not
  shared between browsers, and nothing is stored on the server.
- **Avatar.** A 3D [VRM](https://vrm.dev/en/) model, drawn with three.js and `@pixiv/three-vrm` (only loaded when an
  avatar is shown): Ember for *Voice and avatar, female (premium)* and Nova for *Voice and avatar, male*, both
  about 5 MB in `frontend/public/avatars/`. The browser drives the model's ARKit and viseme blend shapes for the
  mouth, eyelids, brows and smile, its eye bones for the gaze, and its neck, chest and shoulder bones for head sway,
  nods and breathing (`frontend/lib/vrm/rig.ts`). Without WebGL the panel says the avatar cannot be shown.
  - Lip-sync is word-timed: Kokoro's timestamped model reports how long each sound lasts, and the browser turns the
    sounds into overlapping visemes in time with the audio. Where there are no word timings (Dutch), the mouth
    follows the loudness of the voice.
  - The agent starts each reply with a `[mood:x]` tag (`neutral`, `happy`, `sad`, `confused`). The tag is removed
    from the reply and sets the avatar's brows, eyes and smile (`frontend/lib/face.ts`).
  - Listening, thinking and speaking each drive their own idle behaviour.

## Requirements

- Node.js 24 or later and npm (the agent runs TypeScript directly with Node's type stripping).
- Docker with Compose, for the compose setup or for individual services.
- A tool-capable model on an OpenAI-compatible API, or enough free memory for local Ollama. Hosted APIs do not
  require a local LLM download. The browser still needs memory for speech models; settings download a Whisper
  model (80 MB to 600 MB) and the voices (63 MB to 330 MB each).
- A browser with WebGPU (Chrome, Edge) for the best speech recognition and English voices; others fall back to the
  slower WASM.

## Quick start with docker compose

```bash
cp .env.example .env          # optional for Ollama defaults; never overwrite your existing configuration
# Custom wiki folders for Compose go under ./wikis; list them in WIKI_SOURCES.
# Configure the model connection below before starting.
docker compose up --build
```

Then open <http://localhost:3000> (or the port in `FRONTEND_PORT`), open **Settings** for model setup guidance and
speech downloads, pick a language and press **Start**. Model guidance is available in English and Dutch, alongside
a read-only configured provider/model summary (not a connection health check).

Compose starts `livekit`, `agent` and `frontend`.

### Third-party API

Get an API key and choose a chat-completion model that supports **streaming and tool/function calling**. Set:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_AUTH=api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=YOUR_TOOL_CAPABLE_MODEL
LLM_API_KEY=YOUR_API_KEY
```

Replace both placeholders and use your provider's API base URL, including `/v1` when required. This supports
OpenAI-compatible APIs and gateways, not native Anthropic/Gemini protocols. Authentication supports API keys and
Microsoft Entra ID as described below. API-key mode requires all three connection fields and rejects the Ollama
placeholder key. Leave `LLM_REASONING_EFFORT` unset unless your provider/model supports it; set
`LLM_TEMPERATURE=omit` for deployments that reject temperature.

**Docker:** remove an old `LLM_BASE_URL_DOCKER` or set it to the hosted API URL. It overrides `LLM_BASE_URL`.
Run ordinary `docker compose up --build` without the Ollama profile: neither Ollama image is pulled or started.

Keep keys in the server environment or an uncommitted environment file, never in browser storage or
`NEXT_PUBLIC_*` variables. Hosted providers receive questions, wiki excerpts, tool results and conversation
context, including restored history. Requests can incur API charges. Audio recognition and voices stay local.

### Microsoft Entra ID / Enterprise Gateway

Use the gateway's **OpenAI v1** endpoint, not the Azure-native or Anthropic endpoint. `LLM_MODEL` must be a
**deployment name** you are authorized to access. No `api-version` query parameter is needed. Obtain the gateway
and model RBAC permissions first; use an account or identity authorized by your organization.

For **native local development**, install Azure CLI, then sign in to the correct tenant:

```bash
az login --tenant YOUR_TENANT_ID --allow-no-subscriptions
```

Set these in root `.env.local` or `.env`, replacing the example endpoint, resource scope and deployment name with
the values supplied by your gateway administrator:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_AUTH=entra
LLM_BASE_URL=https://api.staging.example.com/openai/v1
LLM_MODEL=YOUR_DEPLOYMENT_NAME
ENTRA_SCOPE=api://api.staging.example.com/.default
ENTRA_AUTH_MODE=cli
LLM_TEMPERATURE=omit
```

Remove `LLM_API_KEY` (it is ignored in Entra mode), and remove an old `LLM_BASE_URL_DOCKER` or change it to the
same gateway URL. Leave `LLM_REASONING_EFFORT` unset unless the deployment supports it. `AZURE_TENANT_ID` is
optional in CLI mode and can pin the credential to the tenant you signed into. Start the native agent and frontend
with `npm run dev:agent` and `npm run dev:frontend`; LiveKit must also be running.

For **production gateway access**, change both environment-specific values together:

```dotenv
LLM_BASE_URL=https://api.example.com/openai/v1
ENTRA_SCOPE=api://api.example.com/.default
```

For **Docker or deployments outside Azure**, use an authorized service principal. Add these to the same gateway
configuration, replacing the placeholders with its tenant ID, application/client ID (not object ID), and secret:

```dotenv
ENTRA_AUTH_MODE=sp
AZURE_TENANT_ID=YOUR_TENANT_ID
AZURE_CLIENT_ID=YOUR_APPLICATION_ID
AZURE_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

```bash
docker compose --env-file .env.local up -d --build --force-recreate agent frontend
```

The standard agent image has neither Azure CLI nor access to your host's CLI login. Do not choose `cli` for that
image or mount your host login cache. Credentials are passed only to the agent; the frontend receives only the
provider/model and authentication type. Keep the secret uncommitted or inject it through deployment secret
management, never the browser.

For **Azure managed identity**, set `ENTRA_AUTH_MODE=managed-identity` on an Azure host exposing the managed
identity endpoint. Set `AZURE_CLIENT_ID` for a user-assigned identity and grant it gateway/model access; omit it
for a system-assigned identity. No client secret is needed. This uses managed identity endpoints, not AKS federated
workload identity. For deployments using service-principal credentials, use `sp`.

`ENTRA_AUTH_MODE=auto` selects service-principal mode when any of `AZURE_TENANT_ID`,
`AZURE_CLIENT_ID` or `AZURE_CLIENT_SECRET` is configured; all three must then be present.
Otherwise it uses Azure CLI. Prefer an explicit mode for predictable identity selection; auto does not detect
managed identity. Azure Identity caches tokens and refreshes them before expiry, and the OpenAI client gets a
current token for every request. Do not copy an expiring access token into `LLM_API_KEY`.

Troubleshooting: token acquisition errors usually indicate a missing CLI login or invalid service-principal
credentials. A 401 can indicate a wrong tenant or scope; a 403 usually indicates missing gateway/model permissions.
A 404 may mean the deployment name is wrong. Token acquisition cannot grant RBAC access automatically.

#### Private CA Certificates

If corporate TLS requires your approved PEM CA certificate, use Node's extra trust store rather than disabling
verification. For native development, export it **before starting Node**:

```bash
export NODE_EXTRA_CA_CERTS="$PWD/certs/organization-ca.pem"
npm run dev:agent
```

The certificate must exist at that path. Setting this only in a dotenv file loaded by the native agent is too late;
Node reads it at process startup.

For Docker, provide a local Compose override with a read-only mount of the approved certificate:

```yaml
services:
  agent:
    environment:
      NODE_EXTRA_CA_CERTS: /app/certs/organization-ca.pem
    volumes:
      - ./certs/organization-ca.pem:/app/certs/organization-ca.pem:ro
```

Include that override using an additional `-f` argument, or use the default `docker-compose.override.yml` convention.
The path inside the container must match `NODE_EXTRA_CA_CERTS`. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### Ollama (Native or Docker)

By default the agent uses Ollama **natively on the host**. Install it from <https://ollama.com>, start it
(`ollama serve` if needed), and download a model with `ollama pull qwen3:4b-instruct`. Native settings:

```dotenv
LLM_PROVIDER=ollama
LLM_AUTH=api-key
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen3:4b-instruct
LLM_API_KEY=ollama
```

For a **Docker agent with native Ollama**, additionally set
`LLM_BASE_URL_DOCKER=http://host.docker.internal:11434/v1`. This is also Docker's Ollama-only default when no
endpoint is configured. On macOS native Ollama is recommended: Docker cannot use Metal.

To run **Ollama in Docker**, use the Ollama settings above, change the override to the service hostname, and enable
the optional profile:

```bash
# .env: LLM_BASE_URL_DOCKER=http://ollama:11434/v1
docker compose --profile ollama up --build     # also pulls LLM_MODEL
```

Set an Ollama model name before enabling the profile; the model-pull service uses `LLM_MODEL`, not a hosted API
model ID. Both `ollama` and `ollama-pull` are optional and are never required dependencies of the agent.

### Apply Changes or Fall Back

Switching is **manual**, with no automatic failover or replay. To fall back from an API, restore the Ollama provider,
model, key and endpoint settings above, set `LLM_AUTH=api-key`, and start native Ollama or enable its profile.
Then recreate the services:

```bash
docker compose up -d --build --force-recreate agent frontend
# For containerized Ollama instead:
docker compose --profile ollama up -d --build
```

A simple `docker compose restart` does not load new environment values. Restart both native processes when not
using Docker. End the existing conversation, reload settings, and start a new conversation.

Native services read root `.env.local` before `.env`; existing process environment wins. Compose reads `.env` by
default and does not automatically read `.env.local`. To use it, add `--env-file .env.local` to every Compose
command. Docker endpoint precedence is `LLM_BASE_URL_DOCKER`, then `LLM_BASE_URL`, then the Ollama-only
`LLM_OLLAMA_BASE_URL` default supplied by Compose. Unset `LLM_PROVIDER` preserves legacy connection settings.

### Troubleshooting

Failures are shown in the app as a notice with numbered fix steps (in English or Dutch). The agent classifies LLM
errors, logs them with a `hint`, and publishes only an error code and redacted facts (provider, model, endpoint
without query string, HTTP status) on the `wiki.error` channel; keys and tokens never reach the logs or the UI. When
a session starts, the agent sends one tiny chat request (`LLM_PREFLIGHT`) so configuration problems show up before
the first question; it logs `LLM reachable (Xms)` on success. View the agent logs with `docker compose logs -f agent`
or in the terminal running `npm run dev -w agent`.

| Symptom | On-screen message | Fix |
|---|---|---|
| Start fails right away | Cannot reach LiveKit | Start `livekit-server --dev` or `docker compose up -d livekit`; check ports 7880/7881 (TCP) and 7882 (UDP) and that the browser can reach `LIVEKIT_URL`. |
| Start fails right away | Could not get an access token | The token route failed; the notice shows its reason (for example an invalid `WIKI_SOURCES`). Check the frontend logs. |
| Start fails right away | LiveKit rejected the credentials | `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` must match for LiveKit, agent and frontend. |
| “Waiting for the agent…”, then a notice after about 20 s | The agent did not join | Start the agent; check that it uses the same `LIVEKIT_URL`, key, secret and `AGENT_NAME` as the frontend. |
| Notice after starting or asking (Ollama) | The language model is unreachable | Run `ollama serve`; check `LLM_BASE_URL`. A Docker agent needs `host.docker.internal`, not `localhost`. |
| Notice after starting or asking (Ollama) | The model was not found | `ollama pull <LLM_MODEL>`. |
| Notice after starting or asking (API) | The language model rejected the credentials (401/403) | Check `LLM_API_KEY`; for Entra check `ENTRA_SCOPE`, tenant and gateway roles. |
| Notice after starting or asking (API) | Could not sign in with Microsoft Entra ID | `az login` (cli mode) or check `ENTRA_AUTH_MODE` and the `AZURE_*` credentials. |
| Notice after starting or asking (API) | The model was not found (404) | Check `LLM_MODEL` (deployment name for gateways) and the `/v1` path in `LLM_BASE_URL`. |
| Notice after starting or asking (API) | The language model is unreachable | Check `LLM_BASE_URL`, DNS/VPN/proxy, and `NODE_EXTRA_CA_CERTS` for a private CA. |
| Notice after asking | The language model rejected the request (400) | Use `LLM_TEMPERATURE=omit`, unset `LLM_REASONING_EFFORT`, and choose a model with streaming and tool calling. |
| Notice after asking | Did not answer in time / rate limit / server error | Increase `LLM_TIMEOUT_S` or use a faster model; wait for quota; check the LLM service. |
| Banner during a conversation | Connection to LiveKit interrupted. Reconnecting… | Usually recovers by itself. If not, the welcome screen shows “Connection to LiveKit lost” with the reason. |
| Notice during a conversation | The agent left the conversation | The LLM failed repeatedly or the agent crashed; see the agent logs and start a new conversation. |

The agent retries failed LLM calls a few times before giving up, so with a long `LLM_TIMEOUT_S` the first notice can
take a while. The frontend settings page includes more model troubleshooting steps.

## Production with docker compose

[`docker-compose.prod.yml`](docker-compose.prod.yml) is an example that uses the published images
`ghcr.io/mdvanes/llm-wiki-avatar-agent` and `ghcr.io/mdvanes/llm-wiki-avatar-frontend` instead of building from the
repo, and runs LiveKit with real keys instead of dev mode. Set these in `.env` (compose refuses to start without them):
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (at least 32 characters, e.g. `openssl rand -base64 32`), `LIVEKIT_NODE_IP`
(the host IP browsers can reach), and `LIVEKIT_PUBLIC_URL` (e.g. `wss://livekit.example.com`). Put custom wiki folders
under `./wikis` beside the Compose file and list them in `WIKI_SOURCES`.

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Browsers only allow the microphone and WebGPU on https, so put the frontend (3000) and LiveKit signalling (7880)
behind a TLS reverse proxy, and open 7881/tcp and 7882/udp for WebRTC media. The frontend has no authentication (see
below). Restrict access at the reverse proxy before enabling paid APIs, otherwise anyone who can reach the app
can spend your API quota. Use the same model settings as development; add `-f docker-compose.prod.yml` to Compose
commands and omit `--build`. New configuration/UI behavior requires images built from this version of the code.

## Native development

Run the services natively, or in containers:

```bash
# LiveKit (dev keys devkey/secret)
brew install livekit && livekit-server --dev              # or: docker compose up livekit
# LLM (skip for a hosted API configured as above)
ollama pull qwen3:4b-instruct                              # or any model, see below
```

Then install the dependencies:

```bash
npm install
cp .env.example .env          # optional
```

In two terminals, start the agent and the frontend, then open <http://localhost:3000> (or the port in `FRONTEND_PORT`):

```bash
npm run dev:agent
npm run dev:frontend
```

Both read `.env.local` and `.env` in the repo root, with `.env.local` taking precedence.

The frontend is built with webpack (`next dev --webpack` / `next build --webpack`, already in the scripts). Both
scripts first copy the ONNX Runtime and eSpeak NG WASM files to `frontend/public/speech/`.

## Configuration

`.env.example` lists the existing settings. The model-provider options and examples are documented above.
The settings you are most likely to change:

| Setting | Default | Notes |
|---|---|---|
| `WIKI_SOURCES` | one `sample-wiki` source | Ordered JSON array of `{ "id", "name", "path" } entries. Relative paths resolve from the repo root; native runs may also use absolute paths. For Compose, custom folders must be under `./wikis`. First source wins ambiguous title lookups; search includes every source. |
| `LLM_PROVIDER` | legacy configuration | `ollama` or `openai-compatible`. Explicit API mode requires URL/model and the selected authentication configuration. Unset preserves existing settings. |
| `LLM_AUTH` | `api-key` | `api-key` for static keys/Ollama, or `entra` for cached and refreshed Microsoft Entra tokens. Entra requires `openai-compatible`. |
| `ENTRA_SCOPE` | unset | Required in Entra mode. Gateway resource scope ending in `/.default`; must match the endpoint environment. |
| `ENTRA_AUTH_MODE` | `cli` | `cli`, `sp`, `managed-identity`, or explicit `auto` (SP fields present: service principal; otherwise CLI). |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | unset | All required for service principal. Tenant optional for CLI; client ID selects a user-assigned managed identity. Agent-only credentials. |
| `LLM_BASE_URL` | `http://localhost:11434/v1` for native Ollama | HTTP(S) OpenAI-compatible API endpoint, without embedded credentials. Required in explicit API mode. |
| `LLM_BASE_URL_DOCKER` | unset | Docker-only endpoint override, taking precedence over `LLM_BASE_URL`. |
| `LLM_API_KEY` | `ollama` for local mode | Server-only key, required for explicit API-key mode and ignored in Entra mode. Never use `NEXT_PUBLIC_*`. |
| `LLM_MODEL` | `qwen3:4b-instruct` | Any model with tool calling on an OpenAI-compatible server. |
| `LLM_TEMPERATURE` | `0.3` | Between 0 and 2, or `omit` to leave the parameter out for models that reject it. |
| `LLM_TIMEOUT_S` | `90` | Connection/first-response timeout in seconds, also passed through Compose. |
| `LLM_REASONING_EFFORT` | unset | Set only when supported. For local `qwen3.5`, `none` gives a faster first word. |
| `LLM_PREFLIGHT` | `true` | Send one tiny chat request when a session starts, to report LLM problems before the first question (and warm up Ollama). Costs a few tokens on paid APIs; set `false` to skip. |
| `DEFAULT_VOICE` | `female` | `off`, `female` or `male`: the voice until the user picks one in the browser. |
| `DEFAULT_LANGUAGE` | `en` | Used when the browser sends no language. |

For example, put two wiki folders under `./wikis`, then configure:

```dotenv
WIKI_SOURCES='[{"id":"product","name":"Product Wiki","path":"wikis/product"},{"id":"engineering","name":"Engineering Wiki","path":"wikis/engineering"}]'
```

Search can return pages from both sources. If an unqualified title matches more than one source, the first configured
source wins; source chips and source-qualified page paths still open the exact page. Each source's root `index.md` and
`log.md` are included with its source label.

The speech recognition model and the voices are downloaded per browser, on the speech settings page.

### Models and latency

Expect the first spoken word a few seconds after you release the mic button. Speech recognition in the browser is
much faster on WebGPU than with WASM, and a bigger Whisper model takes longer. Then come the LLM's first sentence and
the voice for it; Kokoro is much faster on WebGPU too. The first question after a start is slower because the models
are still loading.

- `qwen3:4b-instruct`: fast and decent at tool use; Dutch is acceptable.
- `qwen3.5:9b` with `LLM_REASONING_EFFORT=none`: better answers and better Dutch, but slower. This is the model the
  evals were tuned against.
- Smaller models tend to read commands aloud instead of calling `showOnScreen`. The agent catches this: a reply
  that contains code is shown as an answer card anyway.

### Voices

There is one voice per language and gender, listed in `frontend/lib/tts/voices.ts`: Kokoro `af_heart` and
`am_michael` for English, Piper `nl_BE-nathalie-medium` and `nl_BE-rdh-medium` for Dutch. The two English voices share
one Kokoro model; on WebGPU it runs in full precision (about 330 MB), otherwise 8-bit on WASM (about 90 MB).

## Tests

```bash
npm test          # unit tests (agent + frontend), no services needed
npm run eval      # real configured API or Ollama; hosted calls may incur charges
npm run typecheck
```

Playwright is a frontend development dependency for browser verification. Install Chromium once in the ignored
workspace cache, and use the same `PLAYWRIGHT_BROWSERS_PATH` when running browser checks:

```bash
PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cache/ms-playwright" npx --no-install playwright install chromium
```

The evals check that answers are short and grounded in the wiki, that commands are not spelled out in the spoken
answer, that `showOnScreen` is used for commands, that the agent admits when something isn't in the wiki, and that a
Dutch question gets a Dutch answer.

Evals first make a small streaming chat request through the same configured client; they do not require a
`/models` endpoint. An unreachable local/legacy service skips the evals; explicit API failures and HTTP errors
fail with setup guidance. Run them once for the hosted model and once for Ollama to verify both configurations.

## Repository layout

```
agent/        LiveKit agent: src/ (wikiAgent, tools, prompts, mood, language, wiki/), test/ (unit + evals)
frontend/     Next.js app: token + wiki API routes, speech settings, avatar, transcript, answer cards;
              lib/stt/, lib/tts/ + workers/ for speech recognition and the voices in the browser
sample-wiki/  small example wiki used by default and by the tests
docker-compose.yml, docker-compose.prod.yml, .env.example
```

## Notes and limitations

- **No authentication.** Anyone who can reach port 3000 can start a session and read the wiki. LiveKit runs in dev
  mode with the well-known `devkey`/`secret`. Keep it on localhost or a trusted network, or add auth to
  `frontend/app/api/token` and real LiveKit keys before sharing it. With a hosted model, unauthorized sessions can
  also consume your paid API quota; restrict access at a reverse proxy.
- **Other machines.** To use it from another machine, set `LIVEKIT_PUBLIC_URL` to a URL the browser can reach, and
  change `--node-ip` in `docker-compose.yml` to the host's LAN IP.
- **Dutch speech recognition.** Whisper Base handles Dutch that is full of English technical terms poorly; Small is
  better and Large v3 Turbo best. Identifiers such as `getUserByID` may still come out garbled.
- **Language detection.** The language comes from the selector. Automatic detection is not implemented yet.
- **Licenses.** Kokoro and kokoro-js (whose English text normalization is ported) are Apache-2.0, and the Piper
  voices each have their own license (see their model cards). eSpeak NG, which the browser loads for pronunciation,
  is GPL-3.0.
- **Avatars.** [Ember](https://vtubeme.com/free-vrm-avatars/ember) and
  [Nova](https://vtubeme.com/free-vrm-avatars/nova) are by [VTubeMe](https://vtubeme.com), used unmodified under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the avatar shows a credit link. See
  `frontend/public/avatars/CREDITS.md`.
