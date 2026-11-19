/**
 * Links into the app's pages, with the filters each page really supports.
 *
 * Query parameters, as read by the pages under app/:
 *   /transactions/expenses   ?from=YYYY-MM-DD &to=YYYY-MM-DD &category=<id> &month=YYYY-MM|all
 *   /transactions/income     the same four
 *   /transactions/transfers  ?month=YYYY-MM|all
 *   /plan/budgets            ?month=YYYY-MM
 *   /insights                ?range=month|30d|90d|year|all
 * The other pages take no parameters. No list page can be filtered by
 * account, merchant or search text through its URL, and there is no page for
 * a single transaction.
 *
 * Pure, so the server tool and tests share it. Safe for client code.
 */
import { isValidDay } from '@/lib/dates';

export const APP_PAGES = [
  'dashboard',
  'insights',
  'expenses',
  'income',
  'transfers',
  'accounts',
  'budgets',
  'goals',
  'recurring',
  'friends',
  'categories',
  'merchants',
] as const;

export type AppPage = (typeof APP_PAGES)[number];

const PATHS: Record<AppPage, { path: string; name: string }> = {
  dashboard: { path: '/', name: 'Dashboard' },
  insights: { path: '/insights', name: 'Insights' },
  expenses: { path: '/transactions/expenses', name: 'Expenses' },
  income: { path: '/transactions/income', name: 'Income' },
  transfers: { path: '/transactions/transfers', name: 'Transfers' },
  accounts: { path: '/accounts', name: 'Accounts' },
  budgets: { path: '/plan/budgets', name: 'Budgets' },
  goals: { path: '/plan/goals', name: 'Goals' },
  recurring: { path: '/plan/recurring', name: 'Recurring' },
  friends: { path: '/friends', name: 'Friends' },
  categories: { path: '/settings/categories', name: 'Categories' },
  merchants: { path: '/settings/merchants', name: 'Merchants' },
};

export const INSIGHT_RANGES = ['month', '30d', '90d', 'year', 'all'] as const;

export type LinkInput = {
  page: AppPage;
  /** First day shown (expenses, income). */
  from?: string | null;
  /** Last day shown (expenses, income). */
  to?: string | null;
  /** Category filter (expenses, income). */
  categoryId?: string | null;
  /** YYYY-MM (expenses, income, transfers, budgets). */
  month?: string | null;
  /** Insights only. */
  range?: (typeof INSIGHT_RANGES)[number] | null;
};

export type AppLink = {
  href: string;
  /** The page's name, e.g. "Expenses". */
  page: string;
  /** Filters that were asked for but that this page cannot apply through its URL. */
  ignored: string[];
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Thrown for input the caller can correct. */
export class LinkError extends Error {}

export function buildAppLink(input: LinkInput): AppLink {
  const target = PATHS[input.page];
  if (!target) throw new LinkError(`Unknown page "${input.page}". Use one of: ${APP_PAGES.join(', ')}.`);
  if (input.from && !isValidDay(input.from)) throw new LinkError(`from "${input.from}" is not a real day (YYYY-MM-DD)`);
  if (input.to && !isValidDay(input.to)) throw new LinkError(`to "${input.to}" is not a real day (YYYY-MM-DD)`);
  if (input.from && input.to && input.from > input.to) throw new LinkError(`from ${input.from} is after to ${input.to}`);
  if (input.month && !MONTH.test(input.month)) throw new LinkError(`month "${input.month}" must look like YYYY-MM`);

  const params = new URLSearchParams();
  const ignored: string[] = [];
  const isList = input.page === 'expenses' || input.page === 'income';
  const takesMonth = isList || input.page === 'transfers' || input.page === 'budgets';

  if (input.from || input.to) {
    if (isList) {
      if (input.from) params.set('from', input.from);
      if (input.to) params.set('to', input.to);
    } else ignored.push('date range');
  }
  if (input.categoryId) {
    if (isList) params.set('category', input.categoryId);
    else ignored.push('category');
  }
  if (input.month) {
    // A date range already narrows a list; the month picker would hide part of it.
    if (takesMonth && !(isList && (input.from || input.to))) params.set('month', input.month);
    else if (!takesMonth) ignored.push('month');
  }
  if (input.range) {
    if (input.page === 'insights') params.set('range', input.range);
    else ignored.push('range');
  }

  const query = params.toString();
  return { href: query ? `${target.path}?${query}` : target.path, page: target.name, ignored };
}
