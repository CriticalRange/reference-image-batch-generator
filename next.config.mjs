const isDevelopment = process.env.NODE_ENV === 'development';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  serverExternalPackages: ['sharp'],
  async headers() {
    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "img-src 'self' blob: data:",
          "font-src 'self' data:",
          "style-src 'self' 'unsafe-inline'",
          `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
          "connect-src 'self'",
          'upgrade-insecure-requests'
        ].join('; ')
      },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' }
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders
      }
    ];
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      parquetjs: false
    };
    return config;
  }
};

export default nextConfig;
