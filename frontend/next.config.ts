import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
