import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Proxy /api/* requests to the Express backend (port 3000) so the browser
   * never makes cross-origin requests and we avoid CORS issues entirely.
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL ?? 'http://localhost:3000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
