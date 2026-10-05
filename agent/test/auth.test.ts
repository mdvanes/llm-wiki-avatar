import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzureCliCredential, ClientSecretCredential, ManagedIdentityCredential } from '@azure/identity';
import { createEntraCredential, createEntraTokenProvider } from '../src/auth.ts';
import { loadConfig } from '../src/config.ts';

vi.mock('@azure/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@azure/identity')>();
  return {
    ...actual,
    AzureCliCredential: vi.fn(class { getToken = vi.fn(); }),
    ClientSecretCredential: vi.fn(class { getToken = vi.fn(); }),
    ManagedIdentityCredential: vi.fn(class { getToken = vi.fn(); }),
  };
});

const env = {
  LLM_PROVIDER: 'openai-compatible',
  LLM_AUTH: 'entra',
  LLM_BASE_URL: 'https://api.staging.example.com/openai/v1',
  LLM_MODEL: 'test-deployment',
  ENTRA_SCOPE: 'api://api.staging.example.com/.default',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Entra credentials', () => {
  it('uses Azure CLI for explicit cli and credential-free auto modes', () => {
    for (const mode of ['cli', 'auto']) createEntraCredential(loadConfig({ ...env, ENTRA_AUTH_MODE: mode }));
    expect(AzureCliCredential).toHaveBeenCalledTimes(2);
    expect(ClientSecretCredential).not.toHaveBeenCalled();
  });

  it('uses service-principal credentials for sp and complete auto modes', () => {
    const servicePrincipal = { AZURE_TENANT_ID: 'test-tenant', AZURE_CLIENT_ID: 'test-client', AZURE_CLIENT_SECRET: 'test-secret' };
    for (const mode of ['sp', 'auto']) createEntraCredential(loadConfig({ ...env, ...servicePrincipal, ENTRA_AUTH_MODE: mode }));
    expect(ClientSecretCredential).toHaveBeenCalledTimes(2);
    expect(ClientSecretCredential).toHaveBeenCalledWith('test-tenant', 'test-client', 'test-secret');
    expect(AzureCliCredential).not.toHaveBeenCalled();
  });

  it('selects system-assigned or user-assigned managed identity explicitly', () => {
    createEntraCredential(loadConfig({ ...env, ENTRA_AUTH_MODE: 'managed-identity' }));
    expect(ManagedIdentityCredential).toHaveBeenLastCalledWith();
    createEntraCredential(loadConfig({ ...env, ENTRA_AUTH_MODE: 'managed-identity', AZURE_CLIENT_ID: 'user-assigned-client' }));
    expect(ManagedIdentityCredential).toHaveBeenLastCalledWith({ clientId: 'user-assigned-client' });
  });
});

describe('Entra token provider', () => {
  it('requests the configured scope, caches tokens and refreshes expired credentials', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const getToken = vi.fn()
      .mockResolvedValueOnce({ token: 'first-token', expiresOnTimestamp: now + 3_600_000 })
      .mockResolvedValueOnce({ token: 'refreshed-token', expiresOnTimestamp: now + 7_200_000 });
    const provider = createEntraTokenProvider(loadConfig(env), { getToken });
    expect(await provider()).toBe('first-token');
    expect(await provider()).toBe('first-token');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken.mock.calls[0]?.[0]).toEqual([env.ENTRA_SCOPE]);
    clock.mockReturnValue(now + 3_600_001);
    expect(await provider()).toBe('refreshed-token');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('redacts credential-provider failures', async () => {
    const getToken = vi.fn().mockRejectedValue(new Error('secret-client-credential'));
    const provider = createEntraTokenProvider(loadConfig(env), { getToken });
    await expect(provider()).rejects.toThrow('Entra token acquisition failed');
    await expect(provider()).rejects.not.toThrow('secret-client-credential');
  });

  it('rejects an empty access token without using a static API key', async () => {
    const getToken = vi.fn().mockResolvedValue({ token: '', expiresOnTimestamp: Date.now() + 3_600_000 });
    const provider = createEntraTokenProvider(loadConfig(env), { getToken });
    await expect(provider()).rejects.toThrow('Entra token acquisition failed');
  });
});