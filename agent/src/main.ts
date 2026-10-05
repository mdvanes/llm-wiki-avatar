import { type JobContext, ServerOptions, cli, defineAgent, log, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import type { ReadableStream } from 'node:stream/web';
import { fileURLToPath } from 'node:url';
import { type Config, type Language, type Voice, isLanguage, isLipsync, isVoice, loadConfig } from './config.ts';
import { parseHistoryPayload } from './history.ts';
import { languageProfiles } from './language.ts';
import { MoodFilter } from './mood.ts';
import {
  RPC_INTERRUPT,
  RPC_RESTORE_HISTORY,
  RPC_SET_LANGUAGE,
  RPC_SET_LIPSYNC,
  RPC_SET_VOICE,
  RPC_STOP_SPEAKING,
  RoomPublisher,
} from './publisher.ts';
import { SpeechFilter } from './speechFilter.ts';
import { filterTextStream } from './textStream.ts';
import { WikiAgent } from './wikiAgent.ts';
import { Wiki } from './wiki/wiki.ts';

/** Participant attribute the frontend sets (via its token) to choose the language. */
export const LANGUAGE_ATTRIBUTE = 'language';
/** Participant attribute for the voice: `off` (text replies only), `female` or `male`. */
export const VOICE_ATTRIBUTE = 'voice';
/** Participant attribute for the lip-sync: `audio` or `words` (premium avatar). */
export const LIPSYNC_ATTRIBUTE = 'lipsync';

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

    const wiki = await Wiki.open(cfg.WIKI_SOURCES, {
      poll: cfg.WIKI_WATCH_POLL,
      onReindex: (pages) => {
        logger.info({ pages }, 'wiki reindexed');
        agent.refreshInstructions().catch((err) => logger.warn({ err }, 'could not refresh instructions'));
      },
    });
    ctx.addShutdownCallback(() => wiki.close());
    logger.info({ sources: wiki.store.sources, pages: wiki.store.size }, 'wiki loaded');

    const publisher = new RoomPublisher(ctx.room, (err) => logger.warn({ err }, 'failed to publish to room'));

    // The browser transcribes push-to-talk itself and sends the text as a chat message; it also speaks the replies.
    const session = new voice.AgentSession({
      vad: null,
      llm: createLLM(cfg),
      turnHandling: {
        turnDetection: 'manual',
        preemptiveGeneration: { enabled: false },
      },
      connOptions: {
        llmConnOptions: { timeoutMs: cfg.LLM_TIMEOUT_S * 1000 },
      },
    });

    const agent = new WikiAgent({
      wiki,
      cfg,
      publisher,
      profiles,
      language: cfg.DEFAULT_LANGUAGE,
      voice: cfg.DEFAULT_VOICE,
    });
    wiki.watch();

    await session.start({
      agent,
      room: ctx.room,
      inputOptions: { audioEnabled: false },
      outputOptions: { audioEnabled: false },
    });
    await ctx.connect();

    ctx.room.localParticipant?.registerRpcMethod(RPC_SET_LANGUAGE, async ({ payload, callerIdentity }) => {
      const language = payload.trim().toLowerCase();
      if (!isLanguage(language)) throw new Error(`unsupported language "${payload}"`);
      logger.info({ language, callerIdentity }, 'language switch requested');
      await agent.setLanguage(language);
      return language;
    });

    ctx.room.localParticipant?.registerRpcMethod(RPC_RESTORE_HISTORY, async ({ payload }) => {
      const turns = parseHistoryPayload(payload);
      await agent.restoreHistory(turns);
      logger.info({ turns: turns.length }, 'continuing an earlier conversation');
      return String(turns.length);
    });

    ctx.room.localParticipant?.registerRpcMethod(RPC_STOP_SPEAKING, async ({ payload }) => {
      agent.stopSpeaking(payload.trim());
      logger.info('speech stopped by the user');
      return 'ok';
    });

    ctx.room.localParticipant?.registerRpcMethod(RPC_SET_VOICE, async ({ payload }) => {
      const requested = payload.trim().toLowerCase();
      if (!isVoice(requested)) throw new Error(`unsupported voice "${payload}"`);
      agent.setVoice(requested);
      logger.info({ voice: requested }, 'voice changed');
      return requested;
    });

    ctx.room.localParticipant?.registerRpcMethod(RPC_SET_LIPSYNC, async ({ payload }) => {
      const requested = payload.trim().toLowerCase();
      if (!isLipsync(requested)) throw new Error(`unsupported lipsync "${payload}"`);
      agent.setLipsync(requested);
      logger.info({ lipsync: requested }, 'lipsync changed');
      return requested;
    });

    ctx.room.localParticipant?.registerRpcMethod(RPC_INTERRUPT, async () => {
      session.interrupt();
      return 'ok';
    });

    const participant = await ctx.waitForParticipant();
    const requestedVoice = participant.attributes[VOICE_ATTRIBUTE]?.toLowerCase();
    const initialVoice: Voice = isVoice(requestedVoice) ? requestedVoice : cfg.DEFAULT_VOICE;
    agent.setVoice(initialVoice);
    const requestedLipsync = participant.attributes[LIPSYNC_ATTRIBUTE]?.toLowerCase();
    if (isLipsync(requestedLipsync)) agent.setLipsync(requestedLipsync);
    const requested = participant.attributes[LANGUAGE_ATTRIBUTE]?.toLowerCase();
    const language: Language = isLanguage(requested) ? requested : cfg.DEFAULT_LANGUAGE;
    await agent.setLanguage(language, { announce: false });
    publisher.language(language);
    logger.info({ language, voice: initialVoice, participant: participant.identity }, 'session started');

    agent.say(`[mood:happy] ${profiles[language].greeting}`);
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
