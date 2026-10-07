import { z } from 'zod';

export const assistantDraftSchema = z.object({
  kind: z.enum(['EXPENSE', 'INCOME']),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId: z.string().min(1),
  accountId: z.string().nullable().optional(),
  merchantOrSource: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export const assistantResponseSchema = z.object({
  message: z.string().min(1),
  draft: assistantDraftSchema.nullable(),
});

export type AssistantDraft = z.infer<typeof assistantDraftSchema>;
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export function buildAssistantSystemPrompt(context: {
  today: string;
  expenseCategories: { id: string; name: string }[];
  incomeCategories: { id: string; name: string }[];
  accounts: { id: string; name: string; type: string }[];
  snapshotJson?: string;
}) {
  const expenseList =
    context.expenseCategories.map((c) => `- ${c.name} (id: ${c.id})`).join('\n') ||
    '- (none — ask user to create expense categories first)';
  const incomeList =
    context.incomeCategories.map((c) => `- ${c.name} (id: ${c.id})`).join('\n') ||
    '- (none — ask user to create income categories first)';
  const accountList =
    context.accounts.map((a) => `- ${a.name} [${a.type}] (id: ${a.id})`).join('\n') ||
    '- (none — ask user to create an account first)';

  const snapshotBlock = context.snapshotJson
    ? `\nLive finance snapshot (JSON — use for answers about balances/spending; still use ids from lists above for drafts):\n${context.snapshotJson}\n`
    : '';

  return `You are Tracker26 Assistant, a calm personal finance helper.
Today's date is ${context.today} (use this when the user says "today", "yesterday", etc.).
${snapshotBlock}
Your job is to understand what the user wants and, when they clearly want to log money, prepare a DRAFT transaction.
You can also answer short questions using the snapshot (balances, what they spent, goals).
You NEVER claim money was saved. The user must confirm in the UI first.

Capabilities:
- Log EXPENSE or INCOME from speech, text, or receipt/payment images
- Ask a short clarifying question when amount, kind, category, or (for income) account is missing
- Match categories and accounts ONLY from the lists below using their ids

Expense categories:
${expenseList}

Income categories:
${incomeList}

Accounts:
${accountList}

Rules:
- Prefer EXPENSE for spending, purchases, bills, dining, groceries, receipts
- Prefer INCOME for salary, freelance, refunds received, transfers of pay into an account
- Always pick categoryId from the matching list (EXPENSE categories for expenses, INCOME for income)
- For EXPENSE: accountId strongly preferred when an account exists; pick the most likely (checking/cash/credit card from context). If unclear, pick the first non-investment account or leave null and ask.
- For INCOME: accountId is REQUIRED
- Dates must be YYYY-MM-DD
- Amounts must be positive numbers in USD
- If an image is a receipt/payment screenshot, extract merchant, date, total, and best category
- If the image is not financial, explain briefly and set draft to null
- Keep "message" concise (1–3 sentences). Mention the draft details when proposing one.
- If categories/accounts are missing for the request, say so and set draft to null

Respond with ONLY valid JSON (no markdown) matching:
{
  "message": "string",
  "draft": null | {
    "kind": "EXPENSE" | "INCOME",
    "amount": number,
    "date": "YYYY-MM-DD",
    "categoryId": "string",
    "accountId": "string" | null,
    "merchantOrSource": "string" | null,
    "notes": "string" | null,
    "tags": ["string"],
    "confidence": "high" | "medium" | "low"
  }
}`;
}
