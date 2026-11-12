import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The user's timezone (IANA name). Exposed to client code too so forms and
  // server actions agree on "today". See lib/dates.ts.
  env: {
    APP_TIMEZONE: process.env.APP_TIMEZONE ?? '',
  },
};

export default nextConfig;
