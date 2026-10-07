'use client';

import { useEffect, useState } from 'react';
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
  Grid2x2,
  Sparkles,
  X,
} from 'lucide-react';

const desktopNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/analytics', label: 'Analytics', icon: Sparkles },
  { href: '/categories', label: 'Categories', icon: FolderOpen },
  { href: '/accounts', label: 'Accounts', icon: Wallet },
  { href: '/expenses', label: 'Expenses', icon: TrendingDown },
  { href: '/income', label: 'Income', icon: TrendingUp },
  { href: '/expenses-dashboard', label: 'Expense Dashboard', icon: BarChart3 },
  { href: '/income-dashboard', label: 'Income Dashboard', icon: BarChart2 },
  { href: '/transfers', label: 'Transfers', icon: ArrowLeftRight },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/budgets', label: 'Budgets', icon: PieChart },
];

const mobileTabs = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/expenses', label: 'Expenses', icon: TrendingDown },
  { href: '/income', label: 'Income', icon: TrendingUp },
] as const;

const moreItems = [
  { href: '/analytics', label: 'Analytics', icon: Sparkles, hint: 'AI daily money debrief' },
  { href: '/accounts', label: 'Accounts', icon: Wallet, hint: 'Balances & cards' },
  { href: '/categories', label: 'Categories', icon: FolderOpen, hint: 'Income & spend labels' },
  { href: '/transfers', label: 'Transfers', icon: ArrowLeftRight, hint: 'Move between accounts' },
  { href: '/goals', label: 'Goals', icon: Target, hint: 'Savings targets' },
  { href: '/budgets', label: 'Budgets', icon: PieChart, hint: 'Monthly limits' },
  { href: '/expenses-dashboard', label: 'Expense analytics', icon: BarChart3, hint: 'Charts & filters' },
  { href: '/income-dashboard', label: 'Income analytics', icon: BarChart2, hint: 'Charts & filters' },
];

function isActivePath(pathname: string, href: string) {
  if (href === '/dashboard') {
    return pathname === '/' || pathname === '/dashboard';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Navigation() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const moreActive = moreItems.some((item) => isActivePath(pathname, item.href));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  return (
    <>
      {/* Mobile top brand — light, Instagram-like */}
      <header className="fixed top-0 left-0 right-0 z-40 lg:hidden pt-[env(safe-area-inset-top)]">
        <div className="h-12 px-4 flex items-center justify-between bg-graphite/70 backdrop-blur-xl border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-mint-dim border border-mint/20 flex items-center justify-center">
              <span className="accent-dot" />
            </div>
            <span className="text-[15px] font-semibold text-ink font-display tracking-tight">
              Tracker26
            </span>
          </div>
          <Link
            href="/accounts"
            className="p-2 rounded-full text-ink-secondary hover:text-ink hover:bg-white/[0.04] transition-colors"
            aria-label="Accounts"
          >
            <Wallet size={18} />
          </Link>
        </div>
      </header>

      {/* Desktop sidebar */}
      <nav className="fixed left-0 top-0 h-screen w-64 bg-graphite-elevated/95 backdrop-blur-xl border-r border-graphite-border-subtle flex-col z-50 hidden lg:flex">
        <div className="p-6">
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

        <div className="flex-1 overflow-y-auto py-3 px-3">
          <p className="px-3 mb-2 text-[10px] font-medium text-ink-muted uppercase tracking-[0.18em]">
            Menu
          </p>
          <ul className="space-y-0.5">
            {desktopNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = isActivePath(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
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
                      className={
                        isActive
                          ? 'text-mint'
                          : 'text-ink-muted group-hover:text-ink-secondary'
                      }
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

      {/* Mobile floating glass tab bar */}
      <div className="fixed inset-x-0 bottom-0 z-50 lg:hidden pointer-events-none pb-[max(0.75rem,env(safe-area-inset-bottom))] px-4">
        <nav
          className="pointer-events-auto mx-auto max-w-md floating-tab-bar"
          aria-label="Primary"
        >
          <div className="flex items-stretch justify-between gap-1 px-2 py-2">
            {mobileTabs.map((tab) => {
              const Icon = tab.icon;
              const active = isActivePath(pathname, tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl transition-all duration-200 ${
                    active ? 'text-mint' : 'text-ink-muted active:text-ink-secondary'
                  }`}
                >
                  <span
                    className={`relative flex items-center justify-center w-11 h-8 rounded-full transition-all duration-200 ${
                      active ? 'bg-mint-dim' : ''
                    }`}
                  >
                    <Icon size={22} strokeWidth={active ? 2.35 : 1.75} />
                  </span>
                  <span
                    className={`text-[10px] tracking-wide ${
                      active ? 'font-semibold' : 'font-medium'
                    }`}
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}

            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl transition-all duration-200 ${
                moreOpen || moreActive
                  ? 'text-mint'
                  : 'text-ink-muted active:text-ink-secondary'
              }`}
              aria-label="More"
              aria-expanded={moreOpen}
            >
              <span
                className={`relative flex items-center justify-center w-11 h-8 rounded-full transition-all duration-200 ${
                  moreOpen || moreActive ? 'bg-mint-dim' : ''
                }`}
              >
                <Grid2x2 size={22} strokeWidth={moreOpen || moreActive ? 2.35 : 1.75} />
              </span>
              <span
                className={`text-[10px] tracking-wide ${
                  moreOpen || moreActive ? 'font-semibold' : 'font-medium'
                }`}
              >
                Others
              </span>
            </button>
          </div>
        </nav>
      </div>

      {/* Others sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            aria-label="Close more menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 animate-fade-up">
            <div className="mx-auto max-w-lg rounded-t-3xl border border-graphite-border bg-graphite-surface shadow-panel pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="flex justify-center pt-3 pb-1">
                <span className="w-10 h-1 rounded-full bg-white/15" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-ink font-display">Others</h2>
                  <p className="text-xs text-ink-muted">Everything else</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="p-2 rounded-full text-ink-muted hover:text-ink hover:bg-graphite-surface-2"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-4 pb-2 grid grid-cols-2 gap-2.5">
                {moreItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActivePath(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={`rounded-2xl border p-3.5 transition-colors ${
                        active
                          ? 'border-mint/30 bg-mint-dim'
                          : 'border-graphite-border-subtle bg-graphite-elevated/70 active:bg-graphite-surface-2'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 ${
                          active
                            ? 'bg-mint/15 text-mint'
                            : 'bg-graphite-surface-2 text-ink-secondary'
                        }`}
                      >
                        <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                      </div>
                      <p
                        className={`text-sm font-medium ${
                          active ? 'text-mint' : 'text-ink'
                        }`}
                      >
                        {item.label}
                      </p>
                      <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
                        {item.hint}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
