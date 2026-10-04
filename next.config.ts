import type { NextConfig } from 'next';

// The app runs entirely in the browser, so it builds to plain static files
// (in out/) that any static host can serve.
const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
