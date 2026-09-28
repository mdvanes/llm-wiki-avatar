import type { StreamingTextFilter } from './textStream.ts';

type State = 'text' | 'inline' | 'fence';

const MAX_INLINE = 80;

/** Makes an inline code span speakable: `getUserByID` -> "get User By ID", `mw.go` -> "mw dot go". */
export function speakableCode(code: string): string {
  const s = code.trim();
  if (!s || s.length > 60 || /[(){};=<>|&$]/.test(s)) return '';
  return s
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/(\w)\.(\w)/g, '$1 dot $2')
    .replace(/[_/\\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cleans prose: `[[Page|alias]]` -> alias, bare URLs -> their host name. */
export function speakableText(text: string): string {
  return text
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) =>
      (alias ?? target).trim(),
    )
    .replace(/https?:\/\/([^\s/)]+)[^\s)]*/g, (url: string, host: string) => {
      const trailing = /[.,;:!?]+$/.exec(url)?.[0] ?? '';
      return host.replace(/^www\./, '').replace(/[.,;:!?]+$/, '') + trailing;
    });
}

/**
 * Streaming filter placed in front of TTS so the avatar never reads code aloud:
 * fenced code blocks are dropped, inline code is turned into speakable words, wikilinks and
 * URLs are simplified. Markdown emphasis, headings and lists are left to LiveKit's built-in
 * `filter_markdown` transform, which runs after this one.
 */
export class SpeechFilter implements StreamingTextFilter {
  #buf = '';
  #state: State = 'text';
  #inlineTicks = 1;

  push(chunk: string): string {
    this.#buf += chunk;
    return this.#process(false);
  }

  flush(): string {
    return this.#process(true);
  }

  #process(final: boolean): string {
    let out = '';
    while (this.#buf) {
      if (this.#state === 'fence') {
        const end = this.#buf.indexOf('```');
        if (end < 0) {
          // Drop code, but keep up to two trailing backticks that may start the closing fence.
          this.#buf = final ? '' : this.#buf.slice(-2).replace(/[^`]/g, '');
          break;
        }
        this.#buf = this.#buf.slice(end + 3).replace(/^[^\n]*\n?/, '');
        this.#state = 'text';
        out += ' ';
        continue;
      }

      if (this.#state === 'inline') {
        const close = '`'.repeat(this.#inlineTicks);
        const end = this.#buf.indexOf(close);
        if (end < 0) {
          if (!final && this.#buf.length <= MAX_INLINE) break;
          // Never closed: treat the rest as ordinary text.
          this.#state = 'text';
          continue;
        }
        out += speakableCode(this.#buf.slice(0, end));
        this.#buf = this.#buf.slice(end + this.#inlineTicks);
        this.#state = 'text';
        continue;
      }

      const tick = this.#buf.indexOf('`');
      if (tick < 0) {
        const [ready, rest] = final ? [this.#buf, ''] : splitAtSafeBoundary(this.#buf);
        out += speakableText(ready);
        this.#buf = rest;
        break;
      }
      out += speakableText(this.#buf.slice(0, tick));
      let run = 0;
      while (this.#buf[tick + run] === '`') run++;
      if (tick + run === this.#buf.length && !final) {
        this.#buf = this.#buf.slice(tick);
        break;
      }
      this.#buf = this.#buf.slice(tick + run);
      if (run >= 3) {
        this.#state = 'fence';
      } else {
        this.#state = 'inline';
        this.#inlineTicks = run;
      }
    }
    return out;
  }
}

/** Splits so that the first part ends on whitespace and contains no unfinished `[[wikilink`. */
function splitAtSafeBoundary(text: string): [string, string] {
  let cut = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n')) + 1;
  const open = text.lastIndexOf('[[', cut);
  if (open >= 0) {
    const close = text.indexOf(']]', open);
    if (close < 0) cut = Math.min(cut, open);
    else if (close + 2 > cut) cut = close + 2;
  }
  return [text.slice(0, cut), text.slice(cut)];
}
