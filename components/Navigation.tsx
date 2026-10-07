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
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/budgets', label: 'Budgets', icon: PieChart },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
];

export default function Navigation() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 h-16 z-50 glass lg:hidden">
        <div className="flex items-center justify-between h-full px-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-mint-dim border border-mint/20 flex items-center justify-center">
              <span className="accent-dot" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-ink tracking-tight font-display">
                Tracker26
              </h1>
              <p className="text-[10px] text-ink-muted uppercase tracking-[0.16em]">Finance</p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-graphite-surface-2 transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <nav
        className={`fixed left-0 top-0 h-screen w-64 bg-graphite-elevated/95 backdrop-blur-xl border-r border-graphite-border-subtle flex flex-col z-50 transition-transform duration-300 ease-soft lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-6 hidden lg:block">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-xl bg-mint-dim border border-mint/25 flex items-center justify-center shadow-glow">
              <Wallet size={18} className="text-mint" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-ink tracking-tight font-display">
                Tracker26
              </h1>
              <p className="text-[10px] text-ink-muted uppercase tracking-[0.16em]">
                Finance Manager
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 border-b border-graphite-border-subtle lg:hidden flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-mint-dim border border-mint/20 flex items-center justify-center">
              <Wallet size={15} className="text-mint" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-ink font-display">Tracker26</h1>
              <p className="text-[10px] text-ink-muted uppercase tracking-[0.16em]">Finance</p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-xl text-ink-secondary hover:text-ink hover:bg-graphite-surface-2 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3 px-3">
          <p className="px-3 mb-2 text-[10px] font-medium text-ink-muted uppercase tracking-[0.18em]">
            Menu
          </p>
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] transition-all duration-200 ${
                      isActive
                        ? 'bg-mint-dim text-mint font-medium'
                        : 'text-ink-secondary hover:text-ink hover:bg-graphite-surface-2'
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full bg-mint shadow-glow" />
                    )}
                    <Icon
                      size={17}
                      strokeWidth={isActive ? 2.2 : 1.75}
                      className={isActive ? 'text-mint' : 'text-ink-muted group-hover:text-ink-secondary'}
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="p-4 border-t border-graphite-border-subtle">
          <p className="text-[10px] text-ink-muted text-center tracking-wide">
            Tracker26 · 2026
          </p>
        </div>
      </nav>
    </>
  );
}
