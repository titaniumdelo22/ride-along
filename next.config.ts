import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone opens the laptop's dev server through a cloudflared https link (cameras need https).
  allowedDevOrigins: ["*.trycloudflare.com"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
