import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: false },
  // The social card reads its fonts off disk at request time. Next traces
  // static imports, not a runtime readFile of a path it cannot see, so without
  // this the files are missing from the serverless bundle and /opengraph-image
  // 500s in production while working perfectly on a laptop.
  outputFileTracingIncludes: {
    "/opengraph-image": ["./src/app/_fonts/**"],
  },
};

export default nextConfig;
