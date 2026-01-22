// Type definitions for the application

export type TransactionKind = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type CategoryType = 'INCOME' | 'EXPENSE' | 'BOTH';
export type AccountType = 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'INVESTMENT';
export type DebtType = 'CREDIT_CARD' | 'PERSONAL_LOAN' | 'STUDENT_LOAN' | 'MORTGAGE' | 'AUTO_LOAN' | 'OTHER';
export type InvestmentTransactionType = 'BUY' | 'SELL' | 'CONTRIBUTION' | 'WITHDRAWAL' | 'DIVIDEND';

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color?: string | null;
  icon?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution?: string | null;
  startingBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  date: Date;
  amount: number;
  kind: TransactionKind;
  categoryId?: string | null;
  accountId: string;
  merchantOrSource?: string | null;
  notes?: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  currentBalance: number;
  apr?: number | null;
  minPayment?: number | null;
  dueDay?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  dueDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardData {
  monthIncome: number;
  monthExpenses: number;
  totalDebt: number;
  totalSavings: number;
  totalBalance: number;
  categoryData: Array<{ name: string; value: number; color: string }>;
  monthlyTrend: Array<{ month: string; income: number; expenses: number }>;
}
