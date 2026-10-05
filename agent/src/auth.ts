import {
  AzureCliCredential,
  ClientSecretCredential,
  ManagedIdentityCredential,
  getBearerTokenProvider,
  type TokenCredential,
} from '@azure/identity';
import type { Config } from './config.ts';

export function createEntraCredential(cfg: Config): TokenCredential {
  const mode = cfg.ENTRA_AUTH_MODE === 'auto'
    ? [cfg.AZURE_TENANT_ID, cfg.AZURE_CLIENT_ID, cfg.AZURE_CLIENT_SECRET].some((value) => value?.trim()) ? 'sp' : 'cli'
    : cfg.ENTRA_AUTH_MODE;
  if (mode === 'sp') {
    return new ClientSecretCredential(cfg.AZURE_TENANT_ID!, cfg.AZURE_CLIENT_ID!, cfg.AZURE_CLIENT_SECRET!);
  }
  if (mode === 'managed-identity') {
    return cfg.AZURE_CLIENT_ID
      ? new ManagedIdentityCredential({ clientId: cfg.AZURE_CLIENT_ID })
      : new ManagedIdentityCredential();
  }
  return new AzureCliCredential({ tenantId: cfg.AZURE_TENANT_ID });
}

export function createEntraTokenProvider(cfg: Config, credential?: TokenCredential): () => Promise<string> {
  const provider = getBearerTokenProvider(credential ?? createEntraCredential(cfg), cfg.ENTRA_SCOPE!.trim());
  return async () => {
    try {
      const token = await provider();
      if (!token) throw new Error('Empty Entra access token');
      return token;
    } catch {
      throw new Error('Entra token acquisition failed. Check ENTRA_AUTH_MODE, ENTRA_SCOPE, credentials and gateway access.');
    }
  };
}