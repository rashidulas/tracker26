// Type definitions for the application

export type TransactionKind = 'INCOME' | 'EXPENSE' | 'TRANSFER';
export type CategoryType = 'INCOME' | 'EXPENSE';
export type AccountType = 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'INVESTMENT' | 'LOAN';

export interface Subcategory {
  id: string;
  name: string;
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color?: string | null;
  icon?: string | null;
  subcategories?: Subcategory[];
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
  subcategoryId?: string | null;
  accountId: string;
  merchantOrSource?: string | null;
  notes?: string | null;
  tags: string[];
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
  totalBalance: number;
  cashBalance: number;
  friendsOwedToYou: number;
  friendsYouOwe: number;
  categoryData: Array<{ name: string; value: number; color: string }>;
  monthlyTrend: Array<{ month: string; income: number; expenses: number }>;
}

export type FriendEntryType =
  | 'THEY_OWE_ME'
  | 'I_OWE_THEM'
  | 'THEY_PAID_ME'
  | 'I_PAID_THEM';

export interface Friend {
  id: string;
  name: string;
  notes?: string | null;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FriendEntry {
  id: string;
  friendId: string;
  date: Date;
  amount: number;
  type: FriendEntryType;
  description?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
