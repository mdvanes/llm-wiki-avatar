/** Sums per-file download progress; files count toward the total once they report their size. */
export class FileProgress {
  readonly #files = new Map<string, { loaded: number; total: number }>();

  update(file: string, loaded: number, total: number): { loaded: number; total: number } {
    this.#files.set(file, { loaded, total: Math.max(total, loaded) });
    let sumLoaded = 0;
    let sumTotal = 0;
    for (const f of this.#files.values()) {
      sumLoaded += f.loaded;
      sumTotal += f.total;
    }
    return { loaded: sumLoaded, total: sumTotal };
  }
}
