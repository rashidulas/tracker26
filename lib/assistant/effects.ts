/**
 * Knock-on effects of a saved change: where the budget, account, friend or
 * goal it touched stands now ("that puts Dining at 92% of budget").
 *
 * The figures come from the same read functions as the assistant's read
 * tools (lib/assistant/read.ts), run after the change was committed. They are
 * attached to the write tool's result so the model can mention one without
 * doing any arithmetic of its own.
 */
import {
  accountBalances,
  budgetStatus,
  friendBalances,
  goalProgress,
  type ReadContext,
} from '@/lib/assistant/read';
import type { ActionRefs } from '@/lib/assistant/actions';

export type Effect =
  | {
      type: 'budget';
      month: string;
      category: string;
      budget: number;
      /** Budget plus anything rolled over. */
      available: number;
      spent: number;
      remaining: number;
      usedPct: number | null;
      /** over | near | ahead | ok */
      status: string;
    }
  | {
      type: 'account';
      account: string;
      accountType: string;
      balance: number;
      /** Credit cards and loans. */
      owed?: number;
      availableCredit?: number;
      utilizationPct?: number | null;
    }
  | {
      type: 'friend';
      friend: string;
      /** Positive: they owe the user. Negative: the user owes them. */
      balance: number;
    }
  | { type: 'goal'; goal: string; target: number; saved: number; remaining: number; progressPct: number };

const MAX_EACH = 4;

export async function knockOnEffects(ctx: ReadContext, refs: ActionRefs): Promise<Effect[]> {
  const effects: Effect[] = [];
  try {
    const months = [...new Set(refs.budgets.map((b) => b.month))].slice(0, 2);
    for (const month of months) {
      const wanted = new Set(refs.budgets.filter((b) => b.month === month).map((b) => b.categoryId));
      const status = await budgetStatus(ctx, { month });
      for (const row of status.budgets.filter((b) => wanted.has(b.categoryId)).slice(0, MAX_EACH)) {
        effects.push({
          type: 'budget',
          month,
          category: row.category,
          budget: row.budget,
          available: row.available,
          spent: row.spent,
          remaining: row.remaining,
          usedPct: row.usedPct,
          status: row.status,
        });
      }
    }

    if (refs.accountIds.length > 0) {
      const { accounts } = await accountBalances(ctx);
      for (const a of accounts.filter((row) => refs.accountIds.includes(row.id)).slice(0, MAX_EACH)) {
        effects.push({
          type: 'account',
          account: a.name,
          accountType: a.type,
          balance: a.balance,
          ...(a.owed !== undefined ? { owed: a.owed } : {}),
          ...(a.availableCredit !== undefined ? { availableCredit: a.availableCredit } : {}),
          ...(a.utilizationPct !== undefined ? { utilizationPct: a.utilizationPct } : {}),
        });
      }
    }

    if (refs.friendIds.length > 0) {
      const { friends } = await friendBalances(ctx, {});
      for (const f of friends.filter((row) => refs.friendIds.includes(row.id)).slice(0, MAX_EACH)) {
        effects.push({ type: 'friend', friend: f.name ?? '', balance: f.balance });
      }
    }

    if (refs.goalIds.length > 0) {
      const { goals } = await goalProgress(ctx);
      for (const g of goals.filter((row) => refs.goalIds.includes(row.id)).slice(0, MAX_EACH)) {
        effects.push({
          type: 'goal',
          goal: g.name ?? '',
          target: g.target,
          saved: g.saved,
          remaining: g.remaining,
          progressPct: g.progressPct,
        });
      }
    }
  } catch (error) {
    // The change itself is saved; a failed look-up only means no effect is mentioned.
    console.error('Assistant: could not look up knock-on effects:', error instanceof Error ? error.message : error);
  }
  return effects;
}
