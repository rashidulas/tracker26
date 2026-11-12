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
