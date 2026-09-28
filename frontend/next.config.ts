import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  // The monorepo root holds the lockfile and node_modules.
  outputFileTracingRoot: new URL('..', import.meta.url).pathname,
};

export default nextConfig;
