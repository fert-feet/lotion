import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
      remotePatterns: [
        {
          hostname: "njwnokkclwwglyarylie.supabase.co"
        }
      ]
    },
    // BlockNote 包含 prosemirror/JSDOM 等仅服务端可用的模块，
    // 需在 App Router 服务端路由中标记为外部包（见 @blocknote/server-util 文档）
    serverExternalPackages: [
      "@blocknote/core",
      "@blocknote/react",
      "@blocknote/server-util",
    ]
};

export default nextConfig;
