/** Hands-free mode: listen continuously instead of holding a button. */
export const CONTINUOUS_KEY = 'llm-wiki-avatar.continuousMode';

export function loadContinuous(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(CONTINUOUS_KEY) === 'true';
}

export function saveContinuous(continuous: boolean): void {
  window.localStorage.setItem(CONTINUOUS_KEY, String(continuous));
}
