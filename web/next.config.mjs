/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lint is run separately in CI; don't let it block production builds.
  eslint: { ignoreDuringBuilds: true },
  // Allow larger request bodies on the API routes (base64 conditioning images).
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
