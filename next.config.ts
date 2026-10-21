import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native module: keep it out of the server bundle and load it from node_modules at runtime.
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  // Don't let `next dev` write an AGENTS.md into the repo.
  agentRules: false,
};

export default nextConfig;
