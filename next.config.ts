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
  ["/settings", "/settings/categories"],
];

const nextConfig: NextConfig = {
  async redirects() {
    return legacyRedirects.map(([source, destination]) => ({
      source,
      destination,
      permanent: source !== "/settings",
    }));
  },
};

export default nextConfig;
