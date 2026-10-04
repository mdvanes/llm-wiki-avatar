import { type FSWatcher, watch } from 'chokidar';
import { WikiSearch } from './search.ts';
import { type WikiSource, WikiStore } from './store.ts';

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
  #watchers: FSWatcher[] = [];
  #timer?: NodeJS.Timeout;
  #opts: WikiOptions;

  private constructor(sources: string | WikiSource[], opts: WikiOptions) {
    this.store = new WikiStore(sources);
    this.#opts = opts;
  }

  static async open(sources: string | WikiSource[], opts: WikiOptions = {}): Promise<Wiki> {
    const wiki = new Wiki(sources, opts);
    await wiki.store.load();
    wiki.#search = new WikiSearch(wiki.store);
    return wiki;
  }

  get search(): WikiSearch {
    return this.#search;
  }

  /** Starts watching the wiki folder; changes are applied and re-indexed after a short debounce. */
  watch(): void {
    if (this.#watchers.length) return;
    this.#watchers = this.store.roots.map(({ id, path: root }) => {
      const watcher = watch(root, {
        ignoreInitial: true,
        usePolling: this.#opts.poll ?? false,
        interval: 1000,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
        ignored: (path, stats) =>
          /(^|[/\\])(\.|node_modules)/.test(path.slice(root.length)) ||
          (stats?.isFile() === true && !path.toLowerCase().endsWith('.md')),
      });
      const onChange = async (file: string) => {
        await this.store.reloadFile(file, id).catch(() => undefined);
        this.#scheduleReindex();
      };
      watcher.on('add', onChange).on('change', onChange).on('unlink', (file) => {
        this.store.removeFile(file, id);
        this.#scheduleReindex();
      });
      return watcher;
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
    await Promise.all(this.#watchers.map((watcher) => watcher.close()));
    this.#watchers = [];
  }
}
