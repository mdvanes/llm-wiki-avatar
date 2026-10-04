declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  export interface PiperPhonemizeModule {
    callMain(args: string[]): number;
  }

  export interface PiperPhonemizeOptions {
    wasmBinary?: ArrayBuffer;
    /** Returns the preloaded eSpeak data package instead of letting Emscripten fetch it. */
    getPreloadedPackage?: (name: string, size: number) => ArrayBuffer;
    print?: (line: string) => void;
    printErr?: (line: string) => void;
  }

  export default function createPiperPhonemize(options?: PiperPhonemizeOptions): Promise<PiperPhonemizeModule>;
}
