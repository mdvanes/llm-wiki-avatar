import { describe, expect, it } from 'vitest';
import { publicModelConfig } from '@/lib/server-config';

describe('publicModelConfig', () => {
  it('shows the default Ollama configuration', () => {
    expect(publicModelConfig({})).toEqual({ provider: 'ollama', auth: 'api-key', model: 'qwen3:4b-instruct' });
  });

  it('shows API configuration without supplying an Ollama model default', () => {
    expect(publicModelConfig({ LLM_PROVIDER: 'openai-compatible' })).toEqual({ provider: 'openai-compatible', auth: 'api-key', model: null });
    expect(publicModelConfig({ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'chat-model' })).toEqual({
      provider: 'openai-compatible', auth: 'api-key', model: 'chat-model',
    });
  });

  it('does not infer a provider vendor from a legacy endpoint', () => {
    expect(publicModelConfig({ LLM_BASE_URL: 'https://custom.example/v1' }).provider).toBe('legacy');
    expect(publicModelConfig({ LLM_MODEL: 'custom-model' }).provider).toBe('legacy');
    expect(publicModelConfig({ LLM_PROVIDER: 'ollama', LLM_MODEL: '' })).toEqual({
      provider: 'ollama', auth: 'api-key', model: 'qwen3:4b-instruct',
    });
  });

  it('only serializes the allowlisted model and provider fields', () => {
    const summary = publicModelConfig({
      LLM_PROVIDER: 'openai-compatible',
      LLM_AUTH: 'entra',
      LLM_MODEL: 'chat-model',
      AZURE_TENANT_ID: 'secret-tenant-id',
      AZURE_CLIENT_ID: 'secret-client-id',
      AZURE_CLIENT_SECRET: 'secret-client-credential',
      ENTRA_SCOPE: 'api://private-gateway/.default',
      LLM_API_KEY: 'secret-llm-key',
      LIVEKIT_API_KEY: 'secret-livekit-key',
      LIVEKIT_API_SECRET: 'secret-livekit-secret',
      LLM_BASE_URL: 'https://user:secret-password@example.com/private?token=secret-query',
      LLM_BASE_URL_DOCKER: 'https://private.example.com/v1',
      WIKI_SOURCES: 'secret-wiki-path',
    });
    expect(summary).toEqual({ provider: 'openai-compatible', auth: 'entra', model: 'chat-model' });
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(JSON.stringify(summary)).not.toContain('example.com');
    expect(JSON.stringify(summary)).not.toContain('private-gateway');
  });
});