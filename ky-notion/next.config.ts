import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
      remotePatterns: [
        {
          hostname: "files.edgestore.dev"
        }
      ]
    }
};

export default nextConfig;
