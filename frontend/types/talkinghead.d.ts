// TalkingHead's English text-to-viseme rules (https://github.com/met4citizen/TalkingHead), used for word-timed
// lip-sync. Only this module is used; it has no dependencies of its own.
declare module '@met4citizen/talkinghead/modules/lipsync-en.mjs' {
  export class LipsyncEn {
    preProcessText(s: string): string;
    wordsToVisemes(w: string): { words: string; visemes: string[]; times: number[]; durations: number[] };
  }
}
