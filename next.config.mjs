/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Keep heavy server-only packages out of the webpack bundle
    serverComponentsExternalPackages: ['pdfjs-dist', '@anthropic-ai/sdk'],
  },
};

export default nextConfig;
