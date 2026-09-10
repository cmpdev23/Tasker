import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.AGENTTASKER_BUILD_DIR || ".next",
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
