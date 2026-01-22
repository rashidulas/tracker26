'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderOpen,
  TrendingDown,
  TrendingUp,
  Wallet,
  CreditCard,
  LineChart,
  Target,
  PieChart,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/categories', label: 'Categories', icon: FolderOpen },
  { href: '/accounts', label: 'Accounts', icon: Wallet },
  { href: '/expenses', label: 'Expenses', icon: TrendingDown },
  { href: '/income', label: 'Income', icon: TrendingUp },
  { href: '/debts', label: 'Debts', icon: CreditCard },
  { href: '/investments', label: 'Investments', icon: LineChart },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/budgets', label: 'Budgets', icon: PieChart },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-2xl font-bold text-blue-600">Tracker26</h1>
        <p className="text-sm text-gray-500 mt-1">Finance Manager</p>
      </div>
      
      <div className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-600 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      
      <div className="p-4 border-t border-gray-200">
        <p className="text-xs text-gray-500 text-center">
          © 2026 Tracker26
        </p>
      </div>
    </nav>
  );
}
