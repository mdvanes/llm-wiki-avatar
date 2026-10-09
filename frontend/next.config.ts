import type { NextConfig } from 'next';

// `npm run build:demo`: a static export of the speech echo demo, without the agent-facing API routes.
const demo = process.env.NEXT_PUBLIC_DEMO === '1';

const nextConfig: NextConfig = demo
  ? {
      output: 'export',
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
      // Route handlers are `route.ts`; leaving `ts` out keeps them (token, health, wiki) out of the export.
      pageExtensions: ['tsx', 'jsx'],
      webpack: (config, { isServer }) => {
        if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
        return config;
      },
    }
  : {
      // Self-contained server bundle for the Docker image.
      output: 'standalone',
      // The monorepo root holds the lockfile and node_modules.
      outputFileTracingRoot: new URL('..', import.meta.url).pathname,
      webpack: (config, { isServer }) => {
        // Piper's Emscripten phonemizer only requires these when it runs under Node.
        if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, crypto: false };
        return config;
      },
    };

export default nextConfig;
