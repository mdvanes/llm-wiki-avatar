/** The Cache Storage bucket transformers.js keeps downloaded model files in. */
export const MODEL_CACHE = 'transformers-cache';

/** Cached files are keyed by their Hugging Face URL: https://huggingface.co/<repo>/resolve/<revision>/<file>. */
export function isRepoFile(url: string, repo: string): boolean {
  try {
    return new URL(url).pathname.startsWith(`/${repo}/resolve/`);
  } catch {
    return false;
  }
}

function available(): boolean {
  return typeof caches !== 'undefined';
}

/** Bytes of the repo's files in the browser cache, whichever dtypes they belong to. */
export async function cachedBytes(repo: string): Promise<number> {
  if (!available()) return 0;
  const cache = await caches.open(MODEL_CACHE);
  let total = 0;
  for (const request of await cache.keys()) {
    if (!isRepoFile(request.url, repo)) continue;
    const response = await cache.match(request);
    const length = Number(response?.headers.get('content-length'));
    total += Number.isFinite(length) && length > 0 ? length : ((await response?.blob())?.size ?? 0);
  }
  return total;
}

export async function removeCached(repo: string): Promise<void> {
  if (!available()) return;
  const cache = await caches.open(MODEL_CACHE);
  const requests = (await cache.keys()).filter((request) => isRepoFile(request.url, repo));
  await Promise.all(requests.map((request) => cache.delete(request)));
}

export interface StorageInfo {
  usage: number;
  quota: number;
}

export async function storageInfo(): Promise<StorageInfo | undefined> {
  const estimate = await navigator.storage?.estimate?.();
  if (!estimate?.quota) return undefined;
  return { usage: estimate.usage ?? 0, quota: estimate.quota };
}

/** Asks the browser not to evict the models when space runs low; it may decline. */
export async function persistStorage(): Promise<void> {
  if (await navigator.storage?.persisted?.()) return;
  await navigator.storage?.persist?.().catch(() => false);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}
