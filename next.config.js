/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      '/api/validate': ['./reference_docs/**/*'],
      '/api/source-docs': ['./reference_docs/**/*'],
    },
  },
};

module.exports = nextConfig;
