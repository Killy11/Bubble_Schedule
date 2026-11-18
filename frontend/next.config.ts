import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The server code lives in ../backend and is imported through the "@backend/*" alias, so the build root is the
// repository root: Turbopack compiles it and Vercel traces its files into the serverless functions.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const nextConfig: NextConfig = {
  serverExternalPackages: ["firebase-admin"],
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
