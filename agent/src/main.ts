import { type JobContext, ServerOptions, cli, defineAgent, inference, log, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import type { ReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import { type Config, type Language, isLanguage, loadConfig } from './config.ts';
import { InputModeController, SttTap, isInputMode } from './inputMode.ts';
import { languageProfiles } from './language.ts';
import { MoodFilter } from './mood.ts';
import {
  RPC_PTT_CANCEL,
  RPC_PTT_END,
  RPC_PTT_START,
  RPC_SET_INPUT_MODE,
  RPC_SET_LANGUAGE,
  RoomPublisher,
} from './publisher.ts';
import { SpeachesTTS } from './speachesTts.ts';
import { SpeechFilter } from './speechFilter.ts';
import { filterTextStream } from './textStream.ts';
import { VocabularyCorrector, buildSttPrompt, loadVocabulary } from './vocab.ts';
import { WikiAgent } from './wikiAgent.ts';
import { Wiki } from './wiki/wiki.ts';

/** Participant attribute the frontend sets (via its token) to choose the language. */
export const LANGUAGE_ATTRIBUTE = 'language';
/** Participant attribute for the microphone mode: `always` or `ptt` (push-to-talk). */
export const INPUT_MODE_ATTRIBUTE = 'input_mode';

/** TTS input transforms: drop the mood tag and code, then the built-in markdown/emoji cleanup. */
export function ttsTextTransforms(): voice.AgentSessionOptions['ttsTextTransforms'] {
  return [
    (text: ReadableStream<string>) => filterTextStream(text, new MoodFilter()) as ReadableStream<string>,
    (text: ReadableStream<string>) => filterTextStream(text, new SpeechFilter()) as ReadableStream<string>,
    'filter_markdown',
    'filter_emoji',
  ];
}

export function createLLM(cfg: Config): openai.LLM {
  return new openai.LLM({
    model: cfg.LLM_MODEL,
    baseURL: cfg.LLM_BASE_URL,
    apiKey: cfg.LLM_API_KEY,
    temperature: cfg.LLM_TEMPERATURE,
    ...(cfg.LLM_REASONING_EFFORT ? { reasoningEffort: cfg.LLM_REASONING_EFFORT as never } : {}),
  });
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const cfg = loadConfig();
    const logger = log().child({ component: 'llm-wiki-avatar' });
    const profiles = languageProfiles(cfg);

    const wiki = await Wiki.open(cfg.WIKI_DIR, {
      poll: cfg.WIKI_WATCH_POLL,
      onReindex: (pages) => {
        logger.info({ pages }, 'wiki reindexed');
        agent.refreshInstructions().catch((err) => logger.warn({ err }, 'could not refresh instructions'));
      },
    });
    ctx.addShutdownCallback(() => wiki.close());
    logger.info({ dir: cfg.WIKI_DIR, pages: wiki.store.size }, 'wiki loaded');

    const vocabulary = loadVocabulary(cfg.VOCAB_DIR);
    const sttPrompt = buildSttPrompt(vocabulary);
    const corrector = cfg.STT_FUZZY_CORRECTION ? new VocabularyCorrector(vocabulary) : undefined;
    logger.info({ terms: vocabulary.length, corrections: corrector?.size ?? 0 }, 'vocabulary loaded');

    const initial = profiles[cfg.DEFAULT_LANGUAGE];
    const stt = new openai.STT({
      baseURL: cfg.SPEACHES_URL,
      apiKey: cfg.SPEACHES_API_KEY,
      model: cfg.STT_MODEL,
      useRealtime: false,
      language: initial.whisperLanguage,
      ...(sttPrompt ? { prompt: sttPrompt } : {}),
    });
    const tts = new SpeachesTTS({ ...initial.tts, apiKey: cfg.SPEACHES_API_KEY, speed: cfg.TTS_SPEED });

    const sttTap = new SttTap();
    const publisher = new RoomPublisher(ctx.room, (err) => logger.warn({ err }, 'failed to publish to room'));
    const agent = new WikiAgent({
      wiki,
      cfg,
      publisher,
      profiles,
      language: cfg.DEFAULT_LANGUAGE,
      stt,
      tts,
      sttPrompt,
      corrector,
      sttTap,
    });
    wiki.watch();

    // Pin the local model: without a version, dev mode picks the cloud turn detector.
    const turnDetector = new inference.TurnDetector({ version: 'v1-mini' });
    const session = new voice.AgentSession({
      vad: new inference.VAD(),
      stt,
      llm: createLLM(cfg),
      tts,
      turnHandling: {
        turnDetection: turnDetector,
        interruption: { mode: 'vad' },
        // On CPU a speculative reply competes with the real one for cycles.
        preemptiveGeneration: { enabled: false },
      },
      ttsTextTransforms: ttsTextTransforms(),
      connOptions: {
        llmConnOptions: { timeoutMs: cfg.LLM_TIMEOUT_S * 1000 },
        sttConnOptions: { timeoutMs: cfg.SPEECH_TIMEOUT_S * 1000 },
        ttsConnOptions: { timeoutMs: cfg.SPEECH_TIMEOUT_S * 1000 },
      },
    });

    await session.start({ agent, room: ctx.room });
    await ctx.connect();

    ctx.room.localParticipant?.registerRpcMethod(RPC_SET_LANGUAGE, async ({ payload, callerIdentity }) => {
      const language = payload.trim().toLowerCase();
      if (!isLanguage(language)) throw new Error(`unsupported language "${payload}"`);
      logger.info({ language, callerIdentity }, 'language switch requested');
      await agent.setLanguage(language);
      return language;
    });

    const inputMode = new InputModeController(session, sttTap, {
      autoTurnDetection: turnDetector,
      transcriptTimeoutMs: cfg.SPEECH_TIMEOUT_S * 1000,
    });
    const rpc = ctx.room.localParticipant;
    rpc?.registerRpcMethod(RPC_SET_INPUT_MODE, async ({ payload }) => {
      const mode = payload.trim().toLowerCase();
      if (!isInputMode(mode)) throw new Error(`unsupported input mode "${payload}"`);
      inputMode.setMode(mode);
      logger.info({ mode }, 'input mode changed');
      return mode;
    });
    rpc?.registerRpcMethod(RPC_PTT_START, async () => {
      inputMode.startTurn();
      return 'ok';
    });
    rpc?.registerRpcMethod(RPC_PTT_END, async () => {
      const result = await inputMode.endTurn();
      logger.debug({ result }, 'push-to-talk turn ended');
      return result;
    });
    rpc?.registerRpcMethod(RPC_PTT_CANCEL, async () => {
      inputMode.cancelTurn();
      return 'ok';
    });

    const participant = await ctx.waitForParticipant();
    const requestedMode = participant.attributes[INPUT_MODE_ATTRIBUTE]?.toLowerCase();
    if (isInputMode(requestedMode)) inputMode.setMode(requestedMode);
    const requested = participant.attributes[LANGUAGE_ATTRIBUTE]?.toLowerCase();
    const language: Language = isLanguage(requested) ? requested : cfg.DEFAULT_LANGUAGE;
    await agent.setLanguage(language, { announce: false });
    publisher.language(language);
    logger.info({ language, inputMode: inputMode.mode, participant: participant.identity }, 'session started');

    session.say(`[mood:happy] ${profiles[language].greeting}`);
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: cfg.AGENT_NAME,
      wsURL: cfg.LIVEKIT_URL,
      apiKey: cfg.LIVEKIT_API_KEY,
      apiSecret: cfg.LIVEKIT_API_SECRET,
      numIdleProcesses: 1,
    }),
  );
}
