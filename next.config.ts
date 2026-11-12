import type { NextConfig } from "next";

// Old URLs from before the navigation consolidation. Query strings are passed
// through automatically, so e.g. /expenses?month=2026-01 keeps its filter.
const legacyRedirects: Array<[string, string]> = [
  ["/dashboard", "/"],
  ["/analytics", "/insights"],
  ["/expenses-dashboard", "/insights"],
  ["/income-dashboard", "/insights"],
  ["/expenses", "/transactions/expenses"],
  ["/income", "/transactions/income"],
  ["/transfers", "/transactions/transfers"],
  ["/budgets", "/plan/budgets"],
  ["/goals", "/plan/goals"],
  ["/categories", "/settings/categories"],
];

const nextConfig: NextConfig = {
  // The user's timezone (IANA name). Exposed to client code too so forms and
  // server actions agree on "today". See lib/dates.ts.
  env: {
    APP_TIMEZONE: process.env.APP_TIMEZONE ?? '',
  },
  async redirects() {
    return [
      ...legacyRedirects.map(([source, destination]) => ({
        source,
        destination,
        permanent: true,
      })),
      // /settings has one section for now; not permanent so it can grow a landing page.
      { source: "/settings", destination: "/settings/categories", permanent: false },
    ];
  },
};

export default nextConfig;
