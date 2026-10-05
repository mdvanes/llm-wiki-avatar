import { resolve } from 'node:path';
import { APIConnectionError, APIStatusError, llm } from '@livekit/agents';
import type { Config } from '../src/config.ts';

export const SAMPLE_WIKI = resolve(import.meta.dirname, '..', '..', 'sample-wiki');

export async function probeLLM(model: Pick<llm.LLM, 'chat'>, cfg: Pick<Config, 'LLM_PROVIDER' | 'LLM_TIMEOUT_S'>): Promise<boolean> {
	const chatCtx = llm.ChatContext.empty();
	chatCtx.addMessage({ role: 'user', content: 'Reply with OK.' });
	const stream = model.chat({
		chatCtx,
		connOptions: { timeoutMs: cfg.LLM_TIMEOUT_S * 1000, maxRetry: 0, retryIntervalMs: 0 },
	});
	try {
		const response = await stream.collect();
		if (!response.text.trim()) throw new Error('Empty response');
		return true;
	} catch (error) {
		if (error instanceof APIConnectionError && cfg.LLM_PROVIDER !== 'openai-compatible') return false;
		const status = error instanceof APIStatusError ? ` (HTTP ${error.statusCode})` : '';
		throw new Error(`LLM preflight failed${status}. Check the API key, model, endpoint and LLM_TIMEOUT_S.`);
	} finally {
		stream.close();
	}
}
