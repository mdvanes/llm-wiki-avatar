/** Set at build time when the app is served below a sub-path, as on GitHub Pages. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Static, backend-free build: the speech echo demo for GitHub Pages. */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

/** Prefixes an absolute path of this app with the base path; for plain `<a>` and URLs that Next does not rewrite. */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}
