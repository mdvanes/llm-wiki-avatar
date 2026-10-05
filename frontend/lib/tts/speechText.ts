/**
 * Turns the agent's markdown reply into what the voice says, sentence by sentence. Ported from the agent's speech
 * filter: code blocks are left out, inline code is made speakable, wikilinks and URLs are simplified, and markdown
 * and emoji are removed. Each sentence remembers where it ends in the reply, so the transcript can follow the voice.
 */
import { limitLength, sentenceEnd } from './sentences';

export interface SpeechSegment {
  /** What to say. */
  text: string;
  /** Offset in the reply just past the sentence. */
  end: number;
}

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

/** `[[Page|alias]]` -> alias, bare URLs -> their host name. */
function simplifyLinks(text: string): string {
  return text
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) =>
      (alias ?? target).trim(),
    )
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/([^\s/)]+)[^\s)]*/g, (url: string, host: string) => {
      const trailing = /[.,;:!?]+$/.exec(url)?.[0] ?? '';
      return host.replace(/^www\./, '').replace(/[.,;:!?]+$/, '') + trailing;
    });
}

/** What the voice says for one sentence of markdown; empty when there is nothing to say. */
export function speakable(markdown: string): string {
  const text = simplifyLinks(markdown.replace(/(`+)([^`]*?)\1/g, (_m, _ticks, code: string) => speakableCode(code)))
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/(^|[\s(])[*_~]+(?=\S)/g, '$1')
    .replace(/(?<=\S)[*_~]+(?=$|[\s).,;:!?])/g, '')
    .replace(/\|/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}

function addProse(prose: string, offset: number, complete: boolean, out: SpeechSegment[]): void {
  let rest = prose;
  let start = offset;
  for (let end = sentenceEnd(rest); end >= 0; end = sentenceEnd(rest)) {
    for (const text of limitLength(speakable(rest.slice(0, end)))) out.push({ text, end: start + end });
    start += end;
    rest = rest.slice(end);
  }
  if (complete && rest) {
    for (const text of limitLength(speakable(rest))) out.push({ text, end: start + rest.length });
  }
}

/**
 * The sentences of a (possibly still growing) reply to speak. Until `final`, the last unfinished sentence and an
 * unclosed code block are held back.
 */
export function speechSegments(reply: string, final: boolean): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  let pos = 0;
  while (pos < reply.length) {
    const open = reply.indexOf('```', pos);
    addProse(reply.slice(pos, open < 0 ? reply.length : open), pos, final || open >= 0, out);
    if (open < 0) break;
    const close = reply.indexOf('```', open + 3);
    if (close < 0) break;
    pos = close + 3;
  }
  return out;
}
