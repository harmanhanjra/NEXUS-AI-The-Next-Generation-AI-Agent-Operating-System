/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow builds to use an isolated output directory while `next dev` is running.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Keep file tracing inside this app when another package-lock exists above it.
  outputFileTracingRoot: __dirname,
  // OfficeParser loads optional ESM parsers dynamically; keep Node resolution intact at runtime.
  serverExternalPackages: ['officeparser', 'llamaindex', '@libsql/client'],
  experimental: { cpus: 1, webpackMemoryOptimizations: true },
  webpack(config, { dev }) {
    if (!dev && process.env.NEXUS_LOW_DISK_BUILD === 'true') config.cache = false;
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
