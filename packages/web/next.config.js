/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@qbot/core', '@qbot/ui'],
  experimental: {
    serverActions: true
  }
};

module.exports = nextConfig;
