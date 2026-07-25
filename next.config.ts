import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
      remotePatterns: [
        {
          hostname: "njwnokkclwwglyarylie.supabase.co"
        }
      ]
    }
};

export default nextConfig;
