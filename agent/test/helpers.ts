import { resolve } from 'node:path';
import type { Config } from '../src/config.ts';
import { type PreflightModel, preflightLLM } from '../src/llmDiagnostics.ts';

export const SAMPLE_WIKI = resolve(import.meta.dirname, '..', '..', 'sample-wiki');

/** Like the agent's preflight, but an offline local model skips the evals instead of failing them. */
export async function probeLLM(model: PreflightModel, cfg: Pick<Config, 'LLM_PROVIDER' | 'LLM_TIMEOUT_S'>): Promise<boolean> {
	const result = await preflightLLM(model, cfg);
	if (result.ok) return true;
	const { code, status } = result.error;
	if ((code === 'unreachable' || code === 'timeout') && cfg.LLM_PROVIDER !== 'openai-compatible') return false;
	const suffix = status ? ` (HTTP ${status})` : '';
	throw new Error(`LLM preflight failed${suffix}: ${code}. Check the API key, model, endpoint and LLM_TIMEOUT_S.`);
}
