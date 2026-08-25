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
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 h-16 z-50 bg-zinc-950/80 backdrop-blur-xl border-b border-zinc-800 lg:hidden">
        <div className="flex items-center justify-between h-full px-4">
          <div>
            <h1 className="text-lg font-bold text-emerald-400 tracking-tight">Tracker26</h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Finance Manager</p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-xl hover:bg-zinc-800/60 text-zinc-400 transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <nav
        className={`fixed left-0 top-0 h-screen w-64 bg-zinc-950 border-r border-zinc-800/60 flex flex-col z-50 transition-transform duration-300 ease-out lg:translate-x-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Desktop Header */}
        <div className="p-6 hidden lg:block">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Wallet size={18} className="text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Tracker26</h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Finance Manager</p>
            </div>
          </div>
        </div>

        {/* Mobile Header in Sidebar */}
        <div className="p-4 border-b border-zinc-800/60 lg:hidden flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Wallet size={16} className="text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">Tracker26</h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Finance Manager</p>
            </div>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-xl hover:bg-zinc-800/60 text-zinc-400 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 px-3">
          <p className="px-4 mb-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">Menu</p>
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="p-4 border-t border-zinc-800/40">
          <p className="text-[10px] text-zinc-600 text-center tracking-wide">&copy; 2026 Tracker26</p>
        </div>
      </nav>
    </>
  );
}
