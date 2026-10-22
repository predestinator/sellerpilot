import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native module: keep it out of the server bundle and load it from node_modules at runtime.
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  // Keep the floating dev badge out of demo screenshots/recordings.
  devIndicators: false,
  // Lets a second local server (e.g. a mock-mode demo next to a sandbox one) use its own build dir.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Don't let `next dev` write an AGENTS.md into the repo.
  agentRules: false,
};

export default nextConfig;
