# Conversation
- conversationId: 463247af-2092-4985-a0fd-bb3ef9400ebe
- endpoint: anthropic
- title: Voice Interface for LLM Wiki
- exportAt: 14:49:04 GMT+0200 (Central European Summer Time)

## Options
- presetId: null
- model: claude-opus-5
- resendFiles: true
- maxContextTokens: 64800
- endpoint: anthropic
- endpointType: undefined
- title: Voice Interface for LLM Wiki

## History
**User**
Lets say I have created an llm-wiki for a large repo so my coworkers can query it instead of me. Now I would want to make the threshold to query it even further by placing speech-to-text and text-to-speech to it so they can communicate it by speech. It should also show transcriptions and it would be nice to have a visual avatar that syncs with speech and shows facial reactions when spoken to. I would prefer not to write too much code for this, but pull solutions of the shelf, that are free libre open source (where possible).


**Claude**
{"type":"think","think":""}


**Claude**
## The shape of the thing

You already have the hard part (retrieval + answer quality). What you're adding is a **voice loop** around it:

```
mic → VAD → STT → [your wiki API] → sentence-split → TTS → audio
                ↓                                      ↓
           transcript panel                   visemes/amplitude → avatar
```

Four concerns, and the only one with no perfect off-the-shelf answer is the avatar.

---

## Component picks (all FOSS unless noted)

| Role | Pick | License | Why |
|---|---|---|---|
| VAD / turn-taking | **Silero VAD** | MIT | de-facto standard, tiny, runs in browser via ONNX too |
| STT | **faster-whisper** (or **whisper.cpp**) | MIT | `large-v3-turbo` or `distil-large-v3` is the sweet spot; supports `hotwords`/`initial_prompt` which you'll need |
| STT server | **Speaches** (ex faster-whisper-server) | MIT | serves OpenAI-compatible `/v1/audio/transcriptions` **and** TTS — zero client code, any OpenAI SDK works |
| TTS | **Kokoro-82M** via **kokoro-fastapi** | Apache-2.0 | very good quality for 82M params, CPU-viable, OpenAI-compatible endpoint, **and it can return word-level timestamps** (crucial for lip-sync) |
| TTS (lighter) | **Piper** | MIT | real-time on a Raspberry Pi, dozens of voices, but more robotic |
| TTS (nicer, heavier) | **Chatterbox** | MIT | if you want expressivity/emotion control |
| Avoid | XTTS-v2 | CPML (non-commercial) | licensing landmine at work |

For the avatar:

| Role | Pick | License |
|---|---|---|
| Web avatar engine | **met4citizen/TalkingHead** | MIT |
| Alternative renderer | **@pixiv/three-vrm** + a VRM model | MIT (lib) |
| Offline viseme extraction | **Rhubarb Lip Sync** | MIT |

---

## Two paths, pick based on how much you care about the face

### Path A — "voice tomorrow, no avatar" (≈ a docker-compose file)

Put **Open WebUI** in front of your wiki backend (it speaks OpenAI-compatible APIs, so expose your wiki as a `/v1/chat/completions` endpoint or a pipe/tool). Then:

- Settings → Audio → STT: your Speaches/whisper endpoint
- Settings → Audio → TTS: your kokoro-fastapi endpoint
- Use **Call mode** — hands-free, barge-in, live transcript, all built in.

Literally zero frontend code. Caveats: no avatar, and Open WebUI's license added a branding clause (relevant above ~50 users — check before rolling out org-wide).

This is worth doing **first regardless**, as a baseline to find out whether people actually like talking to it.

### Path B — "with a face"

Use **LiveKit Agents** (Apache-2.0, Python) as the orchestration layer. It gives you, out of the box:

- WebRTC audio transport (works over the network, mobile, no browser audio pain)
- VAD + turn detection + **interruption handling** (this is the thing that makes voice UIs feel alive, and the thing you don't want to write yourself)
- Plugin interfaces for local Whisper/Kokoro/Piper
- Transcriptions published as a data stream → your transcript panel is a `for await` loop
- A React starter UI you can strip down

Your agent is roughly:

```python
session = AgentSession(
    vad=silero.VAD.load(),
    stt=openai.STT(base_url="http://speaches:8000/v1", model="Systran/faster-whisper-large-v3"),
    llm=openai.LLM(base_url="http://my-wiki:8080/v1", model="repo-wiki"),
    tts=openai.TTS(base_url="http://kokoro:8880/v1", voice="af_heart"),
)
```

Then the frontend mounts TalkingHead and feeds it the agent's audio track. Realistically ~300–500 lines of frontend glue, not thousands.

(**Pipecat**, BSD-2, is the same idea with a different flavour — either is fine. Pipecat has avatar integrations but they're SaaS ones like Simli/Tavus, not libre.)

---

## The avatar, concretely

Three tiers of effort:

**Tier 0 — amplitude-driven jaw (~20 lines).** Web Audio `AnalyserNode` → RMS → drive `jawOpen` / VRM `aa` blendshape, with a bit of smoothing. Looks like a Muppet. Honestly: at conversational speed, on a small video tile, most people don't notice. Do this first and see if you care.

**Tier 1 — word-timing driven.** Ask kokoro-fastapi for word timestamps alongside the audio, map words → phonemes (e.g. `phonemizer`/eSpeak NG, GPL — or Kokoro's own G2P) → phonemes → visemes, and feed that timeline to TalkingHead's `speakAudio({audio, words, wtimes, wdurations})`. TalkingHead is designed for exactly this input shape, which is why it's the highest-leverage pick here.

**Tier 2 — Rhubarb.** Run Rhubarb over each TTS chunk (it takes audio + optional transcript, emits A–H mouth-shape timings). Adds ~100–300 ms latency per utterance, so only worth it if you pre-generate or if Tier 1 looks bad.

**Facial reactions** — don't try to infer them from audio. Have the wiki's system prompt emit a lightweight tag the frontend strips before TTS:

```
[mood:neutral] The auth middleware lives in `pkg/auth/mw.go`...
[mood:confused] I don't have anything indexed about that module.
```

Map to `head.setMood('confused')`. Plus free state-driven animation: *listening* → head tilt + eye contact, *retrieving* → glance up/away, *speaking* → idle gestures. That covers 90% of the perceived "it reacts to me" effect for near-zero cost.

**Getting a model:** Ready Player Me (SaaS, free tier, GLB with ARKit blendshapes — what TalkingHead expects) is the fast route. Fully-libre-ish route: VRoid Studio (free, proprietary tool) → VRM → `@pixiv/three-vrm`; VRM has visemes (aa/ih/ou/ee/oh) and expressions (happy/angry/sad/relaxed/surprised) baked into the spec, so the mapping layer is trivial.

---

## Domain gotchas that will bite you

These are specific to "voice interface over a code repo" and matter more than any library choice:

1. **Whisper mangles identifiers.** `getUserByID`, `k8s`, `mmap`, your internal service names — all garbled. Mitigation: extract symbol names / filenames / acronyms from your existing repo index and feed the top few hundred as `hotwords` (faster-whisper) or `initial_prompt`. Optionally add a post-STT fuzzy-correction pass against that same vocabulary. You already have the index; this is cheap and it's the difference between usable and infuriating.

2. **Never TTS a code block.** Have the wiki return two fields: a `spoken` summary (prose, no symbols-as-punctuation) and the full `text` with code. Speak the first, render the second. Otherwise your avatar reads out `open paren open paren asterisk asterisk kwargs`.

3. **Stream per sentence.** Split the LLM stream on sentence boundaries and pipeline into TTS, or first-word latency will be 3–5 s and people will go back to Slacking you.

4. **The transcript is the product; voice is the accessory.** Keep answers copy-pasteable, keep source/file citations clickable. People will ask by voice and read the answer.

---

## What I'd actually do

1. Weekend 1: Open WebUI + Speaches + kokoro-fastapi in docker-compose, pointed at your wiki. Ship it. Add the hotword vocabulary. See if anyone uses it.
2. If yes: rebuild the loop on LiveKit Agents (same STT/TTS containers, so nothing is wasted), reuse the React starter for the transcript panel.
3. Bolt TalkingHead into that frontend at Tier 0 lip-sync + mood tags. Upgrade to word-timing lip-sync only if the Muppet bothers you.

The genuinely novel work is steps 1's hotword trick and the `spoken`/`text` split — everything else is wiring.


