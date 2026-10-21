import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // @sparticuz/chromium finds its brotli binary at run time (import.meta.url + ../bin), which file tracing cannot see.
  // puppeteer-core and @sparticuz/chromium are already in Next's built-in serverExternalPackages list.
  outputFileTracingIncludes: {
    "/api/export/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  // The service worker must always be revalidated (a stale sw.js would pin an old worker) and may control the whole site.
  // Every route may be framed by the app itself only (its tabs, Plan 14c), never by another site.
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
