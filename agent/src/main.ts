import { type JobContext, ServerOptions, cli, defineAgent, log, voice } from '@livekit/agents';
import { existsSync } from 'node:fs';
import * as openai from '@livekit/agents-plugin-openai';
import type { TokenCredential } from '@azure/identity';
import OpenAI from 'openai';
import { fileURLToPath } from 'node:url';
import { createEntraCredential, createEntraTokenProvider } from './auth.ts';
import { type Config, type Language, isLanguage, loadConfig } from './config.ts';
import { parseHistoryPayload } from './history.ts';
import { LANGUAGE_PROFILES } from './language.ts';
import {
  type LLMErrorInfo,
  classifyLLMError,
  configWarnings,
  describeEndpoint,
  hintFor,
  preflightLLM,
} from './llmDiagnostics.ts';
import {
  type Publisher,
  RPC_INTERRUPT,
  RPC_RESTORE_HISTORY,
  RPC_SET_LANGUAGE,
  RoomPublisher,
} from './publisher.ts';
import { WikiAgent } from './wikiAgent.ts';
import { Wiki } from './wiki/wiki.ts';

/** Participant attribute the frontend sets (via its token) to choose the language. */
export const LANGUAGE_ATTRIBUTE = 'language';

export function createLLM(cfg: Config, credential?: TokenCredential): openai.LLM {
  return new openai.LLM({
    model: cfg.LLM_MODEL,
    baseURL: cfg.LLM_BASE_URL,
    ...(cfg.LLM_AUTH === 'entra' ? {
      client: new OpenAI({
        baseURL: cfg.LLM_BASE_URL,
        apiKey: createEntraTokenProvider(cfg, credential),
        maxRetries: 0,
      }),
    } : { apiKey: cfg.LLM_API_KEY }),
    temperature: cfg.LLM_TEMPERATURE,
    ...(cfg.LLM_REASONING_EFFORT ? { reasoningEffort: cfg.LLM_REASONING_EFFORT as never } : {}),
  });
}

type Logger = ReturnType<typeof log>;

/** Logs the LLM setup (no secrets) and warns about combinations that are likely mistakes. */
export function logLLMSetup(cfg: Config, logger: Logger): void {
  const endpoint = describeEndpoint(cfg);
  logger.info({
    ...endpoint,
    timeoutS: cfg.LLM_TIMEOUT_S,
    temperature: cfg.LLM_TEMPERATURE ?? 'omit',
    reasoningEffort: cfg.LLM_REASONING_EFFORT ?? 'unset',
    preflight: cfg.LLM_PREFLIGHT,
  }, 'LLM configuration');
  for (const warning of configWarnings(cfg, { inDocker: existsSync('/.dockerenv') })) logger.warn({ ...endpoint }, warning);
}

/** Logs a classified LLM failure with a hint, and tells the UI (as codes) so it can explain the fix. */
export function reportLLMError(
  info: LLMErrorInfo,
  cfg: Config,
  logger: Logger,
  publisher: Publisher,
  opts: { recoverable?: boolean; source?: string } = {},
): void {
  const endpoint = describeEndpoint(cfg);
  const recoverable = opts.recoverable ?? info.recoverable;
  logger[recoverable ? 'warn' : 'error']({
    ...endpoint,
    source: opts.source ?? 'session',
    code: info.code,
    status: info.status,
    detail: info.detail,
    recoverable,
    hint: hintFor(info.code, endpoint),
  }, `LLM error: ${info.code}`);
  publisher.error({
    code: info.code,
    provider: endpoint.provider,
    model: endpoint.model,
    endpoint: endpoint.endpoint,
    ...(info.status ? { status: info.status } : {}),
    detail: info.detail,
    recoverable,
    timestamp: Date.now(),
  });
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const cfg = loadConfig();
    const logger = log().child({ component: 'llm-wiki-avatar' });
    logLLMSetup(cfg, logger);

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
    const credential = cfg.LLM_AUTH === 'entra' ? createEntraCredential(cfg) : undefined;
    const model = createLLM(cfg, credential);
    const session = new voice.AgentSession({
      vad: null,
      llm: model,
      turnHandling: {
        turnDetection: 'manual',
        preemptiveGeneration: { enabled: false },
      },
      connOptions: {
        llmConnOptions: { timeoutMs: cfg.LLM_TIMEOUT_S * 1000 },
      },
    });

    // Emitted before the session closes on repeated failures, so the UI hears about it before the agent leaves.
    session.on(voice.AgentSessionEventTypes.Error, (ev) => {
      if (ev.error.type !== 'llm_error') {
        logger.error({ type: ev.error.type, err: ev.error }, 'session error');
        return;
      }
      reportLLMError(classifyLLMError(ev.error.error, cfg), cfg, logger, publisher, { recoverable: ev.error.recoverable });
    });
    session.on(voice.AgentSessionEventTypes.Close, (ev) => {
      if (ev.error?.type === 'llm_error') {
        const info = classifyLLMError(ev.error.error, cfg);
        logger.error({ reason: ev.reason, code: info.code, detail: info.detail }, 'session closing due to LLM failure');
      } else if (ev.error) {
        logger.error({ reason: ev.reason, type: ev.error.type }, 'session closing due to an error');
      } else {
        logger.info({ reason: ev.reason }, 'session closed');
      }
    });
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      if (ev.metrics.type !== 'llm_metrics' || ev.metrics.cancelled) return;
      logger.debug({
        durationMs: Math.round(ev.metrics.durationMs),
        ttftMs: Math.round(ev.metrics.ttftMs),
        promptTokens: ev.metrics.promptTokens,
        completionTokens: ev.metrics.completionTokens,
      }, 'LLM call succeeded');
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
    if (cfg.LLM_PREFLIGHT) void runPreflight(createLLM(cfg, credential), cfg, logger, publisher);

    session.say(`[mood:happy] ${LANGUAGE_PROFILES[language].greeting}`);
  },
});

async function runPreflight(model: openai.LLM, cfg: Config, logger: Logger, publisher: Publisher): Promise<void> {
  try {
    const result = await preflightLLM(model, cfg);
    if (result.ok) {
      logger.info({ latencyMs: result.latencyMs, ...describeEndpoint(cfg) }, `LLM reachable (${result.latencyMs}ms)`);
    } else if (result.error.code === 'timeout') {
      // A cold Ollama model load can take longer than the timeout; the first real question may still work.
      logger.warn({ latencyMs: result.latencyMs, ...describeEndpoint(cfg), hint: hintFor('timeout', describeEndpoint(cfg)) },
        'LLM preflight timed out');
    } else {
      reportLLMError(result.error, cfg, logger, publisher, { source: 'preflight' });
    }
  } catch (err) {
    logger.warn({ err }, 'LLM preflight could not run');
  } finally {
    await model.aclose().catch(() => {});
  }
}

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
