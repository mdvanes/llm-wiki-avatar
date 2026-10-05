import { type JobContext, ServerOptions, cli, defineAgent, log, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { fileURLToPath } from 'node:url';
import { type Config, type Language, isLanguage, loadConfig } from './config.ts';
import { parseHistoryPayload } from './history.ts';
import { LANGUAGE_PROFILES } from './language.ts';
import { RPC_INTERRUPT, RPC_RESTORE_HISTORY, RPC_SET_LANGUAGE, RoomPublisher } from './publisher.ts';
import { WikiAgent } from './wikiAgent.ts';
import { Wiki } from './wiki/wiki.ts';

/** Participant attribute the frontend sets (via its token) to choose the language. */
export const LANGUAGE_ATTRIBUTE = 'language';

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

    const agent = new WikiAgent({ wiki, cfg, publisher, language: cfg.DEFAULT_LANGUAGE });
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

    ctx.room.localParticipant?.registerRpcMethod(RPC_INTERRUPT, async () => {
      session.interrupt();
      return 'ok';
    });

    const participant = await ctx.waitForParticipant();
    const requested = participant.attributes[LANGUAGE_ATTRIBUTE]?.toLowerCase();
    const language: Language = isLanguage(requested) ? requested : cfg.DEFAULT_LANGUAGE;
    await agent.setLanguage(language, { announce: false });
    publisher.language(language);
    logger.info({ language, participant: participant.identity }, 'session started');

    session.say(`[mood:happy] ${LANGUAGE_PROFILES[language].greeting}`);
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
