import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The phone opens the laptop's dev server through a cloudflared https link (cameras need https).
  allowedDevOrigins: ["*.trycloudflare.com"],
  cacheComponents: true,
  // No dev badge in the corner during the live demo.
  devIndicators: false,
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
