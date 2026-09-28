import { type FSWatcher, watch } from 'chokidar';
import { WikiSearch } from './search.ts';
import { WikiStore } from './store.ts';

export interface WikiOptions {
  /** Poll the file system instead of using native events (useful for Docker bind mounts). */
  poll?: boolean;
  /** Called after the search index was rebuilt because files changed. */
  onReindex?: (pageCount: number) => void;
}

/** A markdown wiki folder with a search index that stays in sync with the files on disk. */
export class Wiki {
  readonly store: WikiStore;
  #search!: WikiSearch;
  #watcher?: FSWatcher;
  #timer?: NodeJS.Timeout;
  #opts: WikiOptions;

  private constructor(root: string, opts: WikiOptions) {
    this.store = new WikiStore(root);
    this.#opts = opts;
  }

  static async open(root: string, opts: WikiOptions = {}): Promise<Wiki> {
    const wiki = new Wiki(root, opts);
    await wiki.store.load();
    wiki.#search = new WikiSearch(wiki.store);
    return wiki;
  }

  get search(): WikiSearch {
    return this.#search;
  }

  /** Starts watching the wiki folder; changes are applied and re-indexed after a short debounce. */
  watch(): void {
    if (this.#watcher) return;
    this.#watcher = watch(this.store.root, {
      ignoreInitial: true,
      usePolling: this.#opts.poll ?? false,
      interval: 1000,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      ignored: (path, stats) =>
        /(^|[/\\])(\.|node_modules)/.test(path.slice(this.store.root.length)) ||
        (stats?.isFile() === true && !path.toLowerCase().endsWith('.md')),
    });
    const onChange = async (path: string) => {
      await this.store.reloadFile(path).catch(() => undefined);
      this.#scheduleReindex();
    };
    this.#watcher
      .on('add', onChange)
      .on('change', onChange)
      .on('unlink', (path) => {
        try {
          this.store.removeFile(path);
        } catch {
          return;
        }
        this.#scheduleReindex();
      });
  }

  #scheduleReindex(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#search.rebuild();
      this.#opts.onReindex?.(this.store.size);
    }, 300);
  }

  async close(): Promise<void> {
    clearTimeout(this.#timer);
    await this.#watcher?.close();
    this.#watcher = undefined;
  }
}
