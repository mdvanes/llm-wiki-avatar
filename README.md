# llm-wiki-avatar

Talk to your LLM Wiki. You ask a question out loud, and a lip-syncing avatar answers from the wiki in English or
Dutch. A live transcript runs alongside, and commands and code snippets show up on screen instead of being read
aloud.

It implements steps 2 and 3 of [`Voice_Interface for LLM Wiki.md`](./Voice_Interface%20for%20LLM%20Wiki.md) directly
on [LiveKit Agents](https://docs.livekit.io/agents/) for Node, without Open WebUI. Everything runs locally: speech
recognition in the browser, the rest on CPU.

```
Browser (Next.js)                                         agent (Node, @livekit/agents)
  push-to-talk mic ─► Whisper in a Web Worker (WebGPU/WASM)
  transcribed text ──lk.chat──► livekit-server (dev) ◄──►  LLM  Ollama (OpenAI API) + wiki RAG + wiki tools
  cartoon avatar ◄── agent audio                            TTS  Kokoro (en) / Piper (nl) via Speaches
  transcript, sources, answer cards ◄── text streams
  EN / NL selector ──attribute / RPC──►
```

## How it works

- **Wiki.** The agent reads one or more folders of markdown files and indexes them together with BM25. Configure
  all sources, including a single wiki, with `WIKI_SOURCES`. Each source's `index.md` goes
  into the prompt, and on every turn the best matching excerpts are added automatically. The model can also call
  `searchWiki`, `readPage`, `listRecentChanges` and `showOnScreen`. The index updates while you edit the wiki.
- **Voice-first answers.** The model answers in 2–4 spoken sentences. Code, commands and markdown are removed
  before TTS. Replies that contain code, and anything sent through `showOnScreen`, appear as an answer card. The
  sources the answer used appear as chips; click one to open the page, including `[[wikilinks]]`.
- **Languages.** The EN/NL selector sets the speech recognition language, the TTS voice and the reply language. The
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
- **Voice and avatar.** A menu (on the start screen and in the header) picks how the agent answers: *Off* (text
  replies only; you can still talk to it), *Voice only* (female or male) or *Voice and avatar* (female or male). The
  choice is remembered in the browser. It travels as the `voice` participant attribute (`off`, `female` or `male`),
  and changing it during a session sends the `set_voice` RPC. The switch is silent: a spinner shows in the avatar
  window while it happens, and a reply that is being spoken is stopped first (its full text still appears). With
  *Off*, the agent turns its audio output off, so TTS is skipped. Push-to-talk keeps working.
- **Stop button.** While the agent speaks, the *Send* button becomes *Stop*. Clicking it silences the voice and the
  avatar right away (`stop_speaking` RPC), but the reply is still generated to the end. Its full text is streamed
  on the `wiki.reply` topic and replaces the cut-off transcript message, without waiting for speech.
- **Progress status.** Speech recognition and answering can take several seconds, so the UI shows each step:
  *Hearing you…*, *Processing your speech…* and *Preparing an answer…*, with a seconds counter. The status appears
  in the header, as a banner over the avatar, and as a placeholder message in the transcript.
- **Conversation history.** Each conversation in which you said or typed something is saved in the browser
  (`localStorage`, the latest 50), and listed in a sidebar grouped by *Today*, *Yesterday*, *Previous 7 days* and
  month. Click one to read it back, delete it, or *Continue conversation*: the agent then gets the earlier turns
  (the latest ones that fit in 14 KB) through the `restore_history` RPC, so it can refer back to them. History is not
  shared between browsers, and nothing is stored on the server.
- **Avatar.** An animated photo of a man or a woman in business clothes, in front of an office building (no model
  files to download). The face is cut out of the photo onto a WebGL triangle mesh that is bent per frame for the jaw,
  lips, blinks, gaze, brows and head sway, over a still background with the person filled in
  (`frontend/scripts/photo-avatar` builds both; without WebGL a 2D SVG cartoon is shown). The mouth blends between viseme shapes, the eyes
  blink and glance, and the head sways and nods while speaking. Settings live in `frontend/lib/cartoon/` (mouth
  shapes, moods, character looks) and `frontend/lib/photo/`.
  - Lip-sync is driven by the loudness of the agent's audio, so it works for any voice and language.
  - *Voice and avatar, female (premium)* uses word-timed lip-sync instead: the English `af_heart` voice comes from
    [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI), which returns word timestamps with the audio. The
    agent streams them on the `wiki.words` topic, and the browser turns each word into overlapping visemes (with
    [TalkingHead](https://github.com/met4citizen/TalkingHead)'s English rules) in time with the audio, for smoother mouth shapes. The choice travels as the
    `lipsync` participant attribute (`audio` or `words`) and the `set_lipsync` RPC. Dutch, the other options, and any
    sentence Kokoro cannot produce (it is not running, for example) use the regular voice and loudness lip-sync.
  - The agent starts each reply with a `[mood:x]` tag (`neutral`, `happy`, `sad`, `confused`). The tag is removed
    from speech and sets the avatar's brows, eyes and smile.
  - Listening, thinking and speaking each drive their own idle behaviour.

## Requirements

- Node.js 24 or later and npm (the agent runs TypeScript directly with Node's type stripping).
- Docker with Compose, for the compose setup or for individual services.
- About 8 GB of free RAM for the default models. The first start downloads the TTS models and your LLM; the first
  use of the speech settings downloads a Whisper model into the browser (80 MB to 600 MB).
- A browser with WebGPU (Chrome, Edge) for the best speech recognition; others fall back to the slower WASM.

## Quick start with docker compose

```bash
cp .env.example .env          # optional, every setting has a default
# Custom wiki folders for Compose go under ./wikis; list them in WIKI_SOURCES.
docker compose up --build
```

Then open <http://localhost:3000> (or the port in `FRONTEND_PORT`), open **Speech settings** to download a speech
model, pick a language and press **Start**.

Compose starts `livekit`, `speaches`, `agent` and `frontend`. On the first run, `speaches-models` downloads the
TTS models and the agent starts once that has finished; allow a few minutes. Give Docker at least 4 CPUs and 6 GB of
memory (Colima: `colima start --cpu 4 --memory 6`).

**LLM.** By default the agent uses Ollama running **natively on the host** (`LLM_BASE_URL_DOCKER`, default
`http://host.docker.internal:11434/v1`). On macOS this is strongly recommended, because Docker has no access to
Metal and Ollama inside Docker on a Mac is several times slower. To run Ollama in Docker instead:

```bash
# .env: LLM_BASE_URL_DOCKER=http://ollama:11434/v1
docker compose --profile ollama up --build     # also pulls LLM_MODEL
```

**Premium avatar.** *Voice and avatar, female (premium)* needs the `kokoro` service (a 4.5 GB image, about 1.2 GB
of memory). It is in the `premium` profile: `docker compose --profile premium up --build`. Profiles can be combined
(`--profile premium --profile ollama`).

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
below).

## Native development

Run the services natively, or in containers:

```bash
# LiveKit (dev keys devkey/secret)
brew install livekit && livekit-server --dev              # or: docker compose up livekit
# Speaches (TTS)
docker compose up -d speaches-models                       # starts Speaches on :8000 and downloads the models
# LLM
ollama pull qwen3:4b-instruct                              # or any model, see below
# Optional: word-timed lip-sync for the premium avatar (KOKORO_URL=http://localhost:8880)
docker compose --profile premium up -d kokoro
```

Then install the dependencies:

```bash
npm install
cp .env.example .env          # optional
npm run smoke                 # checks wiki, LiveKit, LLM and TTS per language and voice
```

In two terminals, start the agent and the frontend, then open <http://localhost:3000> (or the port in `FRONTEND_PORT`):

```bash
npm run dev:agent
npm run dev:frontend
```

Both read the `.env` in the repo root.

The frontend is built with webpack (`next dev --webpack` / `next build --webpack`, already in the scripts). Both
scripts first copy the ONNX Runtime WASM files to `frontend/public/speech/ort/`.

## Configuration

`.env.example` lists every setting with its default. The ones you are most likely to change:

| Setting | Default | Notes |
|---|---|---|
| `WIKI_SOURCES` | one `sample-wiki` source | Ordered JSON array of `{ "id", "name", "path" } entries. Relative paths resolve from the repo root; native runs may also use absolute paths. For Compose, custom folders must be under `./wikis`. First source wins ambiguous title lookups; search includes every source. |
| `LLM_MODEL` | `qwen3:4b-instruct` | Any model with tool calling on an OpenAI-compatible server. |
| `LLM_REASONING_EFFORT` | unset | Set to `none` for reasoning models such as `qwen3.5` for a much faster first word. |
| `TTS_EN_VOICE` | `af_heart` | Female English voice: any [Kokoro voice](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md). |
| `TTS_NL_MODEL` / `TTS_NL_VOICE` | `speaches-ai/piper-nl_BE-nathalie-medium` / `nathalie` | Female Dutch voice. Other Dutch Piper voices: `nl_NL-mls-medium`, `nl_NL-mls_5809-low`, … |
| `TTS_EN_MALE_VOICE` | `am_michael` | Male English voice (`TTS_EN_MALE_MODEL` defaults to Kokoro). |
| `TTS_NL_MALE_MODEL` / `TTS_NL_MALE_VOICE` | `speaches-ai/piper-nl_BE-rdh-medium` / `rdh` | Male Dutch voice (Flemish). |
| `TTS_*_BASE_URL` | `SPEACHES_URL` | Send one language (and gender, `TTS_*_MALE_BASE_URL`) to a different OpenAI-compatible TTS server. |
| `KOKORO_URL` | unset (compose: `http://kokoro:8880`) | Kokoro-FastAPI for the premium avatar's word-timed lip-sync. Unset: premium uses the regular female voice and loudness lip-sync. |
| `DEFAULT_VOICE` | `female` | `off`, `female` or `male`: the voice until the user picks one in the browser. |
| `DEFAULT_LANGUAGE` | `en` | Used when the browser sends no language. |

For example, put two wiki folders under `./wikis`, then configure:

```dotenv
WIKI_SOURCES='[{"id":"product","name":"Product Wiki","path":"wikis/product"},{"id":"engineering","name":"Engineering Wiki","path":"wikis/engineering"}]'
```

Search can return pages from both sources. If an unqualified title matches more than one source, the first configured
source wins; source chips and source-qualified page paths still open the exact page. Each source's root `index.md` and
`log.md` are included with its source label.

With compose, if you change the TTS models, Speaches preloads the new ones on its next start. The speech recognition
model is chosen per browser on the speech settings page.

### Models and latency

Expect the first spoken word a few seconds after you release the mic button. Speech recognition in the browser is
much faster on WebGPU than with WASM, and a bigger Whisper model takes longer; most of the rest is the LLM's first
sentence. The first question after a start is slower because the models are still loading.

- `qwen3:4b-instruct`: fast and decent at tool use; Dutch is acceptable.
- `qwen3.5:9b` with `LLM_REASONING_EFFORT=none`: better answers and better Dutch, but slower. This is the model the
  evals were tuned against.
- Smaller models tend to read commands aloud instead of calling `showOnScreen`. The agent catches this: a reply
  that contains code is shown as an answer card anyway.

### Voices

The voices are set in the agent (restart it after a change). The `TTS_EN_*`/`TTS_NL_*` settings are the female
voices and `TTS_*_MALE_*` the male ones. If you previously put a male voice in `TTS_EN_VOICE`/`TTS_NL_*`, move it to
the `*_MALE_*` settings, or the "female" options will speak with it:

```dotenv
TTS_EN_MALE_VOICE=am_michael                          # or am_fenrir, am_puck, bm_george (British), …
TTS_NL_MALE_MODEL=speaches-ai/piper-nl_BE-rdh-medium  # Flemish male voice
TTS_NL_MALE_VOICE=rdh
```

Compose downloads all four voices' models. For native runs, download a new model first, for example
`curl -X POST http://localhost:8000/v1/models/speaches-ai/piper-nl_BE-rdh-medium`; `npm run smoke` checks every
language and gender.

## Tests

```bash
npm test          # unit tests (agent + frontend), no services needed
npm run eval      # agent behaviour evals against the real LLM (needs Ollama and LLM_MODEL)
npm run typecheck
```

The evals check that answers are short and grounded in the wiki, that no code is spoken, that `showOnScreen` is
used for commands, that the agent admits when something isn't in the wiki, and that a Dutch question gets a Dutch
answer.

## Repository layout

```
agent/        LiveKit agent: src/ (wikiAgent, tools, prompts, mood, speechFilter, language, wiki/),
              scripts/ (smoke), test/ (unit + evals)
frontend/     Next.js app: token + wiki API routes, speech settings, cartoon avatar, transcript, answer cards;
              lib/stt/ + workers/ for speech recognition in the browser
sample-wiki/  small example wiki used by default and by the tests
docker-compose.yml, docker-compose.prod.yml, .env.example
```

## Notes and limitations

- **No authentication.** Anyone who can reach port 3000 can start a session and read the wiki. LiveKit runs in dev
  mode with the well-known `devkey`/`secret`. Keep it on localhost or a trusted network, or add auth to
  `frontend/app/api/token` and real LiveKit keys before sharing it.
- **Other machines.** To use it from another machine, set `LIVEKIT_PUBLIC_URL` to a URL the browser can reach, and
  change `--node-ip` in `docker-compose.yml` to the host's LAN IP.
- **Dutch speech recognition.** Whisper Base handles Dutch that is full of English technical terms poorly; Small is
  better and Large v3 Turbo best. Identifiers such as `getUserByID` may still come out garbled.
- **Language detection.** The language comes from the selector. Automatic detection is not implemented yet.
- **Licenses.** TalkingHead (its English lip-sync rules) is MIT, Kokoro is Apache-2.0, and the Piper voices each
  have their own license (see their model cards).
- **Avatar photos.** Both avatar photos are by [Vitaly Gariev](https://unsplash.com/@silverkblack) on
  [Unsplash](https://unsplash.com), used (cropped and animated) under the
  [Unsplash License](https://unsplash.com/license):
  [man](https://unsplash.com/photos/man-in-suit-smiling-in-front-of-modern-building-7H-q-K0soEI) and
  [woman](https://unsplash.com/photos/a-woman-in-glasses-stands-with-arms-crossed-outdoors-J_9U-jTWGIw). See
  `frontend/public/avatars/CREDITS.md`. They show real people, and Unsplash photos come without a model release, so
  the photo avatars carry a small "AI avatar" label.
