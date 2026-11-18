import { z } from 'zod';

// Transaction write inputs live in lib/transactions.ts.

// ==================== FILTER SCHEMAS ====================
export const transactionFilterSchema = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  accountId: z.string().optional(),
  kind: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().positive().optional(),
  search: z.string().optional(),
}).refine((data) => {
  if (data.minAmount && data.maxAmount) {
    return data.minAmount <= data.maxAmount;
  }
  return true;
}, {
  message: 'Min amount cannot exceed max amount',
  path: ['maxAmount'],
});

export type TransactionFilter = z.infer<typeof transactionFilterSchema>;

// ==================== BUDGET SCHEMAS ====================
export const budgetInputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Invalid month'),
  categoryId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid category'),
  /** null or 0 removes the budget. */
  amount: z.number().finite().nonnegative('Budget cannot be negative').nullable(),
  rolloverEnabled: z.boolean().optional(),
});

export type BudgetInput = z.infer<typeof budgetInputSchema>;
