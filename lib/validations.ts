import { z } from 'zod';

// ==================== CATEGORY SCHEMAS ====================
export const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  type: z.enum(['INCOME', 'EXPENSE']),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().max(10).optional(),
});

export type CategoryInput = z.infer<typeof categorySchema>;

// ==================== ACCOUNT SCHEMAS ====================
export const accountSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  type: z.enum(['CHECKING', 'SAVINGS', 'CASH', 'CREDIT_CARD', 'INVESTMENT']),
  institution: z.string().max(100).optional(),
  startingBalance: z.number().default(0),
});

export type AccountInput = z.infer<typeof accountSchema>;

// ==================== TRANSACTION SCHEMAS ====================
export const baseTransactionSchema = z.object({
  date: z.date(),
  amount: z.number().positive('Amount must be positive'),
  notes: z.string().max(500).optional(),
  tags: z.array(z.string()).default([]),
});

export const incomeSchema = baseTransactionSchema.extend({
  kind: z.literal('INCOME'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().min(1, 'Account is required'),
  merchantOrSource: z.string().max(100).optional(),
});

export const expenseSchema = baseTransactionSchema.extend({
  kind: z.literal('EXPENSE'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().optional(),
  merchantOrSource: z.string().max(100).optional(),
  splitItems: z.array(z.object({
    categoryId: z.string().min(1),
    amount: z.number().positive(),
    notes: z.string().max(200).optional(),
  })).optional(),
});

const transferBaseSchema = baseTransactionSchema.extend({
  kind: z.literal('TRANSFER'),
  accountId: z.string().min(1, 'From account is required'),
  toAccountId: z.string().min(1, 'To account is required'),
});

export const transferSchema = transferBaseSchema.refine(
  (data) => data.accountId !== data.toAccountId,
  {
    message: 'Cannot transfer to the same account',
    path: ['toAccountId'],
  }
);

export const transactionSchema = z.discriminatedUnion('kind', [
  incomeSchema,
  expenseSchema,
  transferBaseSchema,
]);

export type IncomeInput = z.infer<typeof incomeSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;

// ==================== GOAL SCHEMAS ====================
export const goalSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  targetAmount: z.number().positive('Target amount must be positive'),
  dueDate: z.date().optional(),
});

export const goalContributionSchema = z.object({
  date: z.date(),
  amount: z.number().positive('Amount must be positive'),
  goalId: z.string().min(1, 'Goal is required'),
  fromAccountId: z.string().min(1, 'Account is required'),
  notes: z.string().max(500).optional(),
});

export type GoalInput = z.infer<typeof goalSchema>;
export type GoalContributionInput = z.infer<typeof goalContributionSchema>;

// ==================== BUDGET SCHEMAS ====================
export const budgetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
  categoryId: z.string().min(1, 'Category is required'),
  budgetAmount: z.number().positive('Budget amount must be positive'),
  rolloverEnabled: z.boolean().default(false),
});

export type BudgetInput = z.infer<typeof budgetSchema>;

// ==================== FILTER SCHEMAS ====================
export const transactionFilterSchema = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  categoryId: z.string().optional(),
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
