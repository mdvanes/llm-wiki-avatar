import { type FlushSentinel, llm, log, stt, voice } from '@livekit/agents';
import type * as openai from '@livekit/agents-plugin-openai';
import type { AudioFrame } from '@livekit/rtc-node';
import { ReadableStream, TransformStream } from 'node:stream/web';
import type { Config, Language } from './config.ts';
import type { LanguageProfile } from './language.ts';
import { MoodFilter } from './mood.ts';
import { buildInstructions, buildWikiContext, wikiOverview } from './prompts.ts';
import type { Publisher } from './publisher.ts';
import type { SpeachesTTS } from './speachesTts.ts';
import { type StreamingTextFilter, filterTextStream } from './textStream.ts';
import { SourceTracker, createWikiTools } from './tools.ts';
import type { VocabularyCorrector } from './vocab.ts';
import { parseWikilinks } from './wiki/store.ts';
import type { Wiki } from './wiki/wiki.ts';

type AgentConfig = Pick<
  Config,
  'WIKI_CONTEXT_CHARS' | 'WIKI_INDEX_MAX_CHARS' | 'WIKI_PAGE_MAX_CHARS' | 'WIKI_CONTEXT_ROLE'
>;

export interface WikiAgentOptions {
  wiki: Wiki;
  cfg: AgentConfig;
  publisher: Publisher;
  profiles: Record<Language, LanguageProfile>;
  language: Language;
  /** The session's STT/TTS; switched in place when the language changes. Absent in text-only tests. */
  stt?: openai.STT;
  tts?: SpeachesTTS;
  /** Whisper prompt with hotwords, primes the recognizer to spell identifiers correctly. */
  sttPrompt?: string;
  corrector?: VocabularyCorrector;
}

/** Inline code spans or fenced blocks, as the model writes identifiers and commands. */
export function containsCode(text: string): boolean {
  return /```[\s\S]*?```|`[^`\n]{2,}`/.test(text);
}

/** Passes text through unchanged and reports the complete text when the stream ends. */
class TextCapture implements StreamingTextFilter {
  #text = '';
  readonly #onDone: (text: string) => void;

  constructor(onDone: (text: string) => void) {
    this.#onDone = onDone;
  }

  push(chunk: string): string {
    this.#text += chunk;
    return chunk;
  }

  flush(): string {
    this.#onDone(this.#text);
    return '';
  }
}

export class WikiAgent extends voice.Agent {
  readonly #opts: WikiAgentOptions;
  readonly #sources: SourceTracker;
  #language: Language;
  #lastUserMessageId: string | undefined;

  constructor(opts: WikiAgentOptions) {
    const sources = new SourceTracker(opts.publisher);
    super({
      instructions: WikiAgent.instructionsFor(opts, opts.language),
      tools: createWikiTools({ wiki: opts.wiki, cfg: opts.cfg, publisher: opts.publisher, sources }),
    });
    this.#opts = opts;
    this.#sources = sources;
    this.#language = opts.language;
    this.#applySpeechSettings(opts.language);
  }

  static instructionsFor(opts: Pick<WikiAgentOptions, 'wiki' | 'cfg' | 'profiles'>, language: Language): string {
    return buildInstructions({
      language: opts.profiles[language],
      overview: wikiOverview(opts.wiki.store, opts.cfg.WIKI_INDEX_MAX_CHARS),
    });
  }

  get language(): Language {
    return this.#language;
  }

  get profile(): LanguageProfile {
    return this.#opts.profiles[this.#language];
  }

  /** Switches STT language, TTS voice and reply language; optionally confirms out loud. */
  async setLanguage(language: Language, { announce = true } = {}): Promise<void> {
    if (language === this.#language) return;
    this.#language = language;
    this.#applySpeechSettings(language);
    await this.updateInstructions(WikiAgent.instructionsFor(this.#opts, language));
    this.#opts.publisher.language(language);
    if (announce) {
      this.session.interrupt();
      this.session.say(`[mood:happy] ${this.profile.switched}`);
    }
  }

  /** Rebuilds instructions, e.g. after the wiki index changed on disk. */
  async refreshInstructions(): Promise<void> {
    await this.updateInstructions(WikiAgent.instructionsFor(this.#opts, this.#language));
  }

  #applySpeechSettings(language: Language): void {
    const profile = this.#opts.profiles[language];
    this.#opts.stt?.updateOptions({ language: profile.whisperLanguage, prompt: this.#opts.sttPrompt });
    this.#opts.tts?.updateOptions(profile.tts);
  }

  /**
   * Adds the best matching wiki excerpts right before the latest user message. Done here rather
   * than in onUserTurnCompleted so it also applies to typed input, tool follow-ups and tests; the
   * copy keeps the excerpts out of the conversation history.
   */
  override async llmNode(
    chatCtx: llm.ChatContext,
    toolCtx: llm.ToolContext,
    modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<llm.ChatChunk | string | FlushSentinel> | null> {
    return voice.Agent.default.llmNode(this, this.withWikiContext(chatCtx), toolCtx, modelSettings);
  }

  withWikiContext(chatCtx: llm.ChatContext): llm.ChatContext {
    const items = chatCtx.items;
    let userIdx = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if (item.type === 'message' && item.role === 'user') {
        userIdx = i;
        break;
      }
    }
    if (userIdx < 0) return chatCtx;
    const message = items[userIdx] as llm.ChatMessage;
    if (message.id !== this.#lastUserMessageId) {
      this.#lastUserMessageId = message.id;
      this.#sources.newTurn();
    }
    const question = message.textContent?.trim();
    if (!question) return chatCtx;
    const all = this.#opts.wiki.search.search(question, 3, 600);
    // Weak matches mostly add noise for small models.
    const hits = all.filter((h) => h.score >= (all[0]?.score ?? 0) * 0.25);
    const context = buildWikiContext(hits, this.#opts.cfg.WIKI_CONTEXT_CHARS);
    if (!context) return chatCtx;
    this.#sources.add(hits.slice(0, 3));
    const copy = chatCtx.copy();
    const contextMessage = new llm.ChatMessage({
      role: this.#opts.cfg.WIKI_CONTEXT_ROLE,
      content: context,
      extra: { wikiContext: true },
    });
    copy.items.splice(userIdx, 0, contextMessage);
    return copy;
  }

  override async transcriptionNode(
    text: ReadableStream<string | voice.TimedString> | AsyncIterable<string | voice.TimedString>,
    modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<string | voice.TimedString> | null> {
    const publisher = this.#opts.publisher;
    const sources = this.#sources;
    const store = this.#opts.wiki.store;
    const withoutMood = filterTextStream(text, new MoodFilter((mood) => publisher.mood(mood)));
    // Small models sometimes put code in the reply instead of calling showOnScreen. The speech
    // filter keeps it out of the audio; this puts the reply on screen so the code isn't lost.
    const filtered = filterTextStream(
      withoutMood,
      new TextCapture((reply) => {
        if (!sources.shown && containsCode(reply)) {
          // Pages the reply links to come first; they are what the answer is based on.
          const linked = parseWikilinks(reply).flatMap((name) => {
            const page = store.resolve(name);
            return page ? [{ path: page.path, title: page.title }] : [];
          });
          const all = [...linked, ...sources.list()].filter((s, i, a) => a.findIndex((x) => x.path === s.path) === i);
          publisher.answer({ markdown: reply.trim(), sources: all });
          sources.markShown();
        }
      }),
    );
    return voice.Agent.default.transcriptionNode(this, filtered, modelSettings);
  }

  override async sttNode(
    audio: ReadableStream<AudioFrame> | AsyncIterable<AudioFrame>,
    modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<stt.SpeechEvent | string> | null> {
    const events = await voice.Agent.default.sttNode(this, audio, modelSettings);
    const corrector = this.#opts.corrector;
    if (!events || !corrector || corrector.size === 0) return events;
    const logger = log();
    return events.pipeThrough(
      new TransformStream<stt.SpeechEvent | string, stt.SpeechEvent | string>({
        transform(event, controller) {
          if (typeof event === 'string' || event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT || !event.alternatives) {
            controller.enqueue(event);
            return;
          }
          const [first, ...rest] = event.alternatives;
          const text = corrector.correct(first.text);
          if (text !== first.text) logger.debug({ from: first.text, to: text }, 'vocabulary correction');
          controller.enqueue({ ...event, alternatives: [{ ...first, text }, ...rest] });
        },
      }),
    );
  }
}
