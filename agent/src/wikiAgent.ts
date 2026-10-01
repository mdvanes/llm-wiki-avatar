import { type FlushSentinel, llm, log, stt, voice } from '@livekit/agents';
import type * as openai from '@livekit/agents-plugin-openai';
import type { AudioFrame } from '@livekit/rtc-node';
import { ReadableStream, TransformStream } from 'node:stream/web';
import type { Config, Language, Lipsync, Voice } from './config.ts';
import { type HistoryTurn, withRestoredHistory } from './history.ts';
import type { SttTap } from './inputMode.ts';
import type { LanguageProfile } from './language.ts';
import { MoodFilter } from './mood.ts';
import { buildInstructions, buildWikiContext, wikiOverview } from './prompts.ts';
import type { Publisher } from './publisher.ts';
import { ReplyCapture, captureLlmStream } from './replyCapture.ts';
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
  /** Lets push-to-talk flush STT on release and follow its progress. */
  sttTap?: SttTap;
  /** Initial voice; `off` makes replies text only. Defaults to `female`. */
  voice?: Voice;
  /** The session's audio output; turned off for the `off` voice. */
  audioOutput?: AudioOutputSwitch;
  /** `words`: use the voice with word timings where available (premium avatar). Defaults to `audio`. */
  lipsync?: Lipsync;
}

/** The part of the session output that turns speech on and off (`session.output`). */
export interface AudioOutputSwitch {
  setAudioEnabled(enabled: boolean): void;
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
  #voice: Voice;
  #lipsync: Lipsync;
  #lastUserMessageId: string | undefined;
  /** Text of the reply currently being generated or spoken. */
  #reply: ReplyCapture | undefined;

  constructor(opts: WikiAgentOptions) {
    const sources = new SourceTracker(opts.publisher);
    super({
      instructions: WikiAgent.instructionsFor(opts, opts.language),
      tools: createWikiTools({ wiki: opts.wiki, cfg: opts.cfg, publisher: opts.publisher, sources }),
    });
    this.#opts = opts;
    this.#sources = sources;
    this.#language = opts.language;
    this.#voice = opts.voice ?? 'female';
    this.#lipsync = opts.lipsync ?? 'audio';
    this.#applySpeechSettings();
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

  get voice(): Voice {
    return this.#voice;
  }

  get lipsync(): Lipsync {
    return this.#lipsync;
  }

  get profile(): LanguageProfile {
    return this.#opts.profiles[this.#language];
  }

  /** Switches STT language, TTS voice and reply language; optionally confirms out loud. */
  async setLanguage(language: Language, { announce = true } = {}): Promise<void> {
    if (language === this.#language) return;
    this.#language = language;
    this.#applySpeechSettings();
    await this.updateInstructions(WikiAgent.instructionsFor(this.#opts, language));
    this.#opts.publisher.language(language);
    if (announce) {
      this.session.interrupt();
      this.say(`[mood:happy] ${this.profile.switched}`);
    }
  }

  /**
   * Switches the voice gender, or turns speech off (`off`: replies are text only; STT keeps working).
   * Takes effect from the next reply; the caller stops a reply that is being spoken.
   */
  setVoice(voice: Voice): void {
    if (voice === this.#voice) return;
    this.#voice = voice;
    this.#applySpeechSettings();
  }

  /**
   * `words` asks for the voice with word timings (English female only), whose timings drive the premium avatar's
   * lip-sync; elsewhere the regular voice is used. Takes effect from the next sentence.
   */
  setLipsync(lipsync: Lipsync): void {
    if (lipsync === this.#lipsync) return;
    this.#lipsync = lipsync;
    this.#applySpeechSettings();
  }

  /** Speaks a fixed text; use instead of `session.say` so the text can be shown in full when stopped. */
  say(text: string): voice.SpeechHandle {
    this.#reply = ReplyCapture.of(text);
    return this.session.say(text);
  }

  /**
   * Stops the voice right away (the button in the UI), but keeps generating the reply and streams
   * all of its text to the UI, where it replaces the transcript message `target`.
   */
  stopSpeaking(target: string): void {
    const reply = this.#reply;
    reply?.keep();
    const before = new Set(this.chatCtx.items.map((item) => item.id));
    this.session.interrupt();
    if (!reply) return;

    const writer = this.#opts.publisher.fullReply(target);
    reply.follow(
      (text) => writer.write(text),
      () => writer.close(),
    );

    // The chat history gets the spoken part only; give the model the whole reply that is on screen.
    const session = this.session;
    const onItem = (ev: voice.ConversationItemAddedEvent) => {
      const item = ev.item;
      if (item.type !== 'message' || item.role !== 'assistant' || before.has(item.id)) return;
      session.off(voice.AgentSessionEventTypes.ConversationItemAdded, onItem);
      clearTimeout(timer);
      if (item.interrupted) void reply.complete().then((text) => this.#replaceMessageText(item.id, text));
    };
    const timer = setTimeout(() => session.off(voice.AgentSessionEventTypes.ConversationItemAdded, onItem), 10_000);
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, onItem);
  }

  async #replaceMessageText(id: string, text: string): Promise<void> {
    const ctx = this.chatCtx.copy();
    const item = ctx.getById(id);
    if (item?.type !== 'message' || !text.trim()) return;
    item.content = [text];
    await this.updateChatCtx(ctx).catch((err: unknown) => log().warn({ err }, 'could not update the stopped reply'));
  }

  /** Continues an earlier conversation: its turns become part of this session's chat history. */
  async restoreHistory(turns: HistoryTurn[]): Promise<void> {
    if (turns.length === 0) return;
    await this.updateChatCtx(withRestoredHistory(this.chatCtx, turns));
  }

  /** Rebuilds instructions, e.g. after the wiki index changed on disk. */
  async refreshInstructions(): Promise<void> {
    await this.updateInstructions(WikiAgent.instructionsFor(this.#opts, this.#language));
  }

  #applySpeechSettings(): void {
    const profile = this.#opts.profiles[this.#language];
    this.#opts.stt?.updateOptions({ language: profile.whisperLanguage, prompt: this.#opts.sttPrompt });
    this.#opts.audioOutput?.setAudioEnabled(this.#voice !== 'off');
    // Keep the TTS on a real voice even when off, so turning speech back on needs no extra step.
    const gender = this.#voice === 'off' ? 'female' : this.#voice;
    const wordTimed = this.#lipsync === 'words' && gender === 'female' ? profile.wordTimedVoice : undefined;
    this.#opts.tts?.setVoice(wordTimed ?? profile.voices[gender]);
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
    const stream = await voice.Agent.default.llmNode(this, this.withWikiContext(chatCtx), toolCtx, modelSettings);
    if (!stream) return stream;
    this.#reply = new ReplyCapture();
    return captureLlmStream(stream, this.#reply);
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
    const tap = this.#opts.sttTap;
    let events = await voice.Agent.default.sttNode(this, tap ? tap.wrapAudio(audio) : audio, modelSettings);
    if (events && tap) events = tap.watchEvents(events);
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
