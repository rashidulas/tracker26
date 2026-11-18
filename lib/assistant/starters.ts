/**
 * What the chat screen needs before the first message: suggested prompts
 * chosen from what the user actually has (budgets, goals, bills, friends),
 * and the account and category lists for editing a proposal on its card.
 *
 * Only names and "is there any" checks are read here. Every figure in an
 * answer still comes from the assistant's tools.
 */
import type { PrismaClient } from '@prisma/client';
import { addDays, dayFilter, monthRange, type DayString } from '@/lib/dates';

export type StarterDb = Pick<
  PrismaClient,
  'account' | 'category' | 'transaction' | 'budget' | 'goal' | 'friendEntry' | 'recurringTransaction'
>;

export type StarterPrompt = {
  label: string;
  /** Text for the composer. */
  prompt: string;
  /** False: put the text in the composer for the user to finish, instead of sending it. */
  send: boolean;
};

export type ChatReference = {
  accounts: { id: string; name: string; type: string }[];
  categories: { id: string; name: string; type: 'INCOME' | 'EXPENSE' }[];
};

export const LOG_EXPENSE_STARTER: StarterPrompt = {
  label: 'Log an expense',
  prompt: 'I spent $',
  send: false,
};

const MAX_STARTERS = 6;
const short = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 40);

export async function loadChatReference(db: Pick<PrismaClient, 'account' | 'category'>): Promise<ChatReference> {
  const [accounts, categories] = await Promise.all([
    db.account.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
    db.category.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
  ]);
  return { accounts, categories };
}

export async function loadStarterPrompts(db: StarterDb, today: DayString): Promise<StarterPrompt[]> {
  const [recent, budgets, goal, friendEntries, recurring, cards, categories] = await Promise.all([
    db.transaction.findMany({
      where: { kind: 'EXPENSE', date: dayFilter(addDays(today, -30), today) },
      select: { categoryId: true, amount: true },
    }),
    db.budget.count({ where: { month: monthRange(today) } }),
    db.goal.findFirst({ select: { name: true }, orderBy: { createdAt: 'desc' } }),
    db.friendEntry.count(),
    db.recurringTransaction.count({ where: { active: true } }),
    db.account.count({ where: { type: 'CREDIT_CARD' } }),
    db.category.findMany({ where: { type: 'EXPENSE' }, select: { id: true, name: true } }),
  ]);

  // The category with the most spending lately, only to pick a name to ask about.
  const byCategory = new Map<string, number>();
  for (const row of recent) {
    if (row.categoryId) byCategory.set(row.categoryId, (byCategory.get(row.categoryId) ?? 0) + row.amount);
  }
  const topId = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const topCategory = categories.find((c) => c.id === topId)?.name;

  const ask = (label: string): StarterPrompt => ({ label, prompt: label, send: true });
  const prompts: StarterPrompt[] = [];
  if (budgets > 0) prompts.push(ask('How am I doing against my budgets?'));
  if (recent.length > 0) prompts.push(ask('What did I spend this week?'));
  if (topCategory) {
    prompts.push(ask(`How much did I spend on ${short(topCategory)} this month versus last month?`));
  }
  if (recurring > 0) prompts.push(ask('What bills are coming up?'));
  if (goal) prompts.push(ask(`How close am I to my ${short(goal.name)} goal?`));
  if (friendEntries > 0) prompts.push(ask('Who owes me money?'));
  if (cards > 0) prompts.push(ask('What do I owe on my credit cards?'));
  if (prompts.length === 0) prompts.push(ask('What are my account balances?'));

  return [...prompts.slice(0, MAX_STARTERS - 1), LOG_EXPENSE_STARTER];
}
