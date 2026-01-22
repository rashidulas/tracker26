'use client';

import { useState } from 'react';
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
  BarChart3,
  ArrowLeftRight,
  BarChart2,
  Menu,
  X,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/categories', label: 'Categories', icon: FolderOpen },
  { href: '/accounts', label: 'Accounts', icon: Wallet },
  { href: '/expenses', label: 'Expenses', icon: TrendingDown },
  { href: '/income', label: 'Income', icon: TrendingUp },
  { href: '/expenses-dashboard', label: 'Expense Dashboard', icon: BarChart3 },
  { href: '/income-dashboard', label: 'Income Dashboard', icon: BarChart2 },
  { href: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { href: '/debts', label: 'Debts', icon: CreditCard },
  { href: '/investments', label: 'Investments', icon: LineChart },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/budgets', label: 'Budgets', icon: PieChart },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
];

export default function Navigation() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 lg:hidden">
        <div className="flex items-center justify-between p-4">
          <div>
            <h1 className="text-xl font-bold text-blue-600">Tracker26</h1>
            <p className="text-xs text-gray-500">Finance Manager</p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-lg hover:bg-gray-100"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <nav
        className={`fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-200 flex flex-col z-50 transition-transform duration-300 lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Desktop Header */}
        <div className="p-6 border-b border-gray-200 hidden lg:block">
          <h1 className="text-2xl font-bold text-blue-600">Tracker26</h1>
          <p className="text-sm text-gray-500 mt-1">Finance Manager</p>
        </div>

        {/* Mobile Header in Sidebar */}
        <div className="p-4 border-b border-gray-200 lg:hidden flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-blue-600">Tracker26</h1>
            <p className="text-xs text-gray-500">Finance Manager</p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-lg hover:bg-gray-100"
          >
            <X size={20} />
          </button>
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
                    onClick={() => setIsMobileMenuOpen(false)}
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
          <p className="text-xs text-gray-500 text-center">© 2026 Tracker26</p>
        </div>
      </nav>
    </>
  );
}
