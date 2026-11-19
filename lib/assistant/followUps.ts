/**
 * Follow-up suggestions shown under the assistant's latest answer.
 *
 * Chosen in code from which tools the answer used, so they cost nothing,
 * appear the moment the answer ends, and never suggest something the
 * assistant cannot do.
 */
import { LOG_EXPENSE_STARTER, type StarterPrompt } from '@/lib/assistant/starters';
import { WRITE_TOOL_PARTS } from '@/lib/assistant/toolLabels';

type Part = {
  type: string;
  text?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  approval?: { isAutomatic?: boolean };
};

const ask = (label: string): StarterPrompt => ({ label, prompt: label, send: true });

const MAX = 3;

export function followUpsFor(message: { role: string; parts: unknown[] } | undefined): StarterPrompt[] {
  if (!message || message.role !== 'assistant') return [];
  const parts = message.parts as Part[];
  const tools = parts.filter((p) => p.type.startsWith('tool-'));
  const isWrite = (p: Part) => WRITE_TOOL_PARTS.has(p.type);
  const isLog = (p: Part) =>
    p.type === 'tool-createExpense' || p.type === 'tool-createIncome' || p.type === 'tool-logTransactions';

  // A card is waiting for a decision: nothing should compete with it.
  if (tools.some((p) => isWrite(p) && (p.state === 'approval-requested' || p.state === 'approval-responded'))) {
    return [];
  }
  // The assistant asked something: the next move is to answer it.
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n').trim();
  if (text.endsWith('?')) return [];

  const out: StarterPrompt[] = [];
  const add = (...items: StarterPrompt[]) => {
    for (const item of items) if (!out.some((o) => o.label === item.label)) out.push(item);
  };

  if (tools.some((p) => isLog(p) && p.state === 'output-available')) {
    add(
      { ...LOG_EXPENSE_STARTER, label: 'Log another' },
      ask('What have I spent today?'),
      ask('How am I doing against my budgets?')
    );
  }
  // After any other saved change, look at what it changed.
  for (const part of tools.filter((p) => isWrite(p) && !isLog(p) && p.state === 'output-available')) {
    switch (part.type.slice(5)) {
      case 'changeTransactions':
        add(ask('What have I spent this month?'), ask('How am I doing against my budgets?'));
        break;
      case 'moveMoney':
        add(ask('What are my account balances?'), ask('What do I owe on my credit cards?'));
        break;
      case 'updateFriends':
        add(ask('Who owes me money?'), ask('What are my account balances?'));
        break;
      case 'updateGoals':
        add(ask('How are my goals going?'), ask('What are my account balances?'));
        break;
      case 'updateBudgets':
        add(ask('How am I doing against my budgets?'));
        break;
      case 'updateRecurring':
        add(ask('What bills are coming up?'));
        break;
    }
  }

  // The answer's last read tool says most about where to go next.
  const done = tools.filter((p) => !isWrite(p) && p.state === 'output-available').reverse();
  for (const part of done) {
    const input = part.input ?? {};
    switch (part.type.slice(5)) {
      case 'summarizeTransactions':
        if (input.groupBy === 'day' || input.groupBy === 'week' || input.groupBy === 'month') {
          add(ask('Break that down by category'), ask('Compare it with the period before'));
        } else if (input.groupBy === 'category') {
          add(ask('Compare that with the month before'), ask('Show the biggest transactions'));
        } else {
          add(ask('Break that down by category'), ask('Show the biggest transactions'));
        }
        break;
      case 'comparePeriods':
        add(ask('Which merchants changed the most?'), ask('Show the transactions behind this'));
        break;
      case 'searchTransactions':
        add(ask('Total these by category'));
        if (typeof part.output?.nextOffset === 'number') add(ask('Show more'));
        add(ask('Total these by merchant'));
        break;
      case 'accountBalances':
        add(ask('What bills are coming up?'), ask('What did I spend this week?'));
        break;
      case 'budgetStatus':
        add(ask('Where did the biggest category go?'), ask('What did I spend this week?'));
        break;
      case 'goalProgress':
        add(ask('What are my account balances?'), ask('What bills are coming up?'));
        break;
      case 'friendBalances':
        add(ask('What are my account balances?'), ask('What did I spend this week?'));
        break;
      case 'upcomingRecurring':
        add(ask('What are my account balances?'), ask('How am I doing against my budgets?'));
        break;
      case 'linkToPage':
        // A link is not an answer worth following up on by itself.
        break;
    }
  }

  if (out.length === 0 && text) {
    add(ask('What did I spend this week?'), ask('How am I doing against my budgets?'));
  }
  return out.slice(0, MAX);
}
