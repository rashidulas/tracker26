'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  ListOrdered,
  Target,
  Wallet,
  Grid2x2,
  Settings,
  Users,
  MessageCircle,
  X,
  type LucideIcon,
} from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  /** Extra path prefixes that belong to this section. */
  also?: string[];
};

const HOME: NavItem = {
  href: '/',
  label: 'Home',
  icon: Home,
  hint: 'Overview and insights',
  also: ['/insights'],
};
const TRANSACTIONS: NavItem = {
  href: '/transactions',
  label: 'Transactions',
  icon: ListOrdered,
  hint: 'Expenses, income, transfers',
};
const PLAN: NavItem = { href: '/plan', label: 'Plan', icon: Target, hint: 'Budgets and goals' };
const ACCOUNTS: NavItem = {
  href: '/accounts',
  label: 'Accounts',
  icon: Wallet,
  hint: 'Balances, cards & loans',
};
const FRIENDS: NavItem = {
  href: '/friends',
  label: 'Friends',
  icon: Users,
  hint: 'IOUs and shared money',
};
const CHAT: NavItem = {
  href: '/chat',
  label: 'Chat',
  icon: MessageCircle,
  hint: 'Ask or log by chatting',
};
const SETTINGS: NavItem = {
  href: '/settings',
  label: 'Settings',
  icon: Settings,
  hint: 'Categories',
};

const desktopNavItems = [HOME, TRANSACTIONS, PLAN, ACCOUNTS, FRIENDS, CHAT];
const mobileTabs = [HOME, TRANSACTIONS, CHAT];
const moreItems = [PLAN, ACCOUNTS, FRIENDS, SETTINGS];

function isActivePath(pathname: string, item: NavItem) {
  return [item.href, ...(item.also ?? [])].some((href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
  );
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const isActive = isActivePath(pathname, item);
  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13.5px] transition-all duration-200 ${
        isActive
          ? 'bg-mint-dim text-mint font-medium'
          : 'text-ink-secondary hover:text-ink hover:bg-graphite-surface-2'
      }`}
    >
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full bg-mint shadow-glow"
        />
      )}
      <Icon
        aria-hidden="true"
        size={17}
        strokeWidth={isActive ? 2.2 : 1.75}
        className={isActive ? 'text-mint' : 'text-ink-muted group-hover:text-ink-secondary'}
      />
      <span>{item.label}</span>
    </Link>
  );
}

export default function Navigation() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const moreActive = moreItems.some((item) => isActivePath(pathname, item));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // The "More" sheet is a modal dialog: lock scroll, trap focus, Escape closes,
  // and focus returns to the trigger.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trigger = moreButtonRef.current;
    sheetRef.current?.querySelector<HTMLElement>('a[href], button')?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [moreOpen]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[90] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-mint focus:text-graphite focus:font-medium"
      >
        Skip to content
      </a>

      {/* Mobile top brand */}
      <header className="fixed top-0 left-0 right-0 z-40 lg:hidden pt-[env(safe-area-inset-top)]">
        <div className="h-12 px-4 flex items-center justify-between bg-graphite/70 backdrop-blur-xl border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg bg-mint-dim border border-mint/20 flex items-center justify-center"
              aria-hidden="true"
            >
              <span className="accent-dot" />
            </div>
            <span className="text-[15px] font-semibold text-ink font-display tracking-tight">
              Tracker26
            </span>
          </div>
          <Link
            href="/accounts"
            className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-full text-ink-secondary hover:text-ink hover:bg-white/[0.04] transition-colors"
            aria-label="Accounts"
          >
            <Wallet size={18} aria-hidden="true" />
          </Link>
        </div>
      </header>

      {/* Desktop sidebar */}
      <nav
        aria-label="Main"
        className="fixed left-0 top-0 h-screen w-64 bg-graphite-elevated/95 backdrop-blur-xl border-r border-graphite-border-subtle flex-col z-50 hidden lg:flex"
      >
        <div className="p-6">
          <div className="flex items-center gap-3">
            <div
              className="relative w-10 h-10 rounded-xl bg-mint-dim border border-mint/25 flex items-center justify-center shadow-glow"
              aria-hidden="true"
            >
              <Wallet size={18} className="text-mint" strokeWidth={2} />
            </div>
            <div>
              <p className="text-lg font-semibold text-ink tracking-tight font-display">
                Tracker26
              </p>
              <p className="text-[10px] text-ink-muted uppercase tracking-[0.16em]">
                Finance Manager
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-3 px-3">
          <ul className="space-y-0.5">
            {desktopNavItems.map((item) => (
              <li key={item.href}>
                <SidebarLink item={item} pathname={pathname} />
              </li>
            ))}
          </ul>
        </div>

        <div className="p-3 border-t border-graphite-border-subtle">
          <SidebarLink item={SETTINGS} pathname={pathname} />
        </div>
      </nav>

      {/* Mobile floating tab bar */}
      <div className="fixed inset-x-0 bottom-0 z-50 lg:hidden pointer-events-none pb-[max(0.75rem,env(safe-area-inset-bottom))] px-4">
        <nav className="pointer-events-auto mx-auto max-w-md floating-tab-bar" aria-label="Main">
          <div className="flex items-stretch justify-between gap-1 px-2 py-2">
            {mobileTabs.map((tab) => {
              const Icon = tab.icon;
              const active = isActivePath(pathname, tab);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl transition-all duration-200 ${
                    active ? 'text-mint' : 'text-ink-muted active:text-ink-secondary'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`relative flex items-center justify-center w-11 h-8 rounded-full transition-all duration-200 ${
                      active ? 'bg-mint-dim' : ''
                    }`}
                  >
                    <Icon size={22} strokeWidth={active ? 2.35 : 1.75} />
                  </span>
                  <span
                    className={`text-[10px] tracking-wide ${active ? 'font-semibold' : 'font-medium'}`}
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}

            <button
              ref={moreButtonRef}
              type="button"
              onClick={() => setMoreOpen(true)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl transition-all duration-200 ${
                moreOpen || moreActive ? 'text-mint' : 'text-ink-muted active:text-ink-secondary'
              }`}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              <span
                aria-hidden="true"
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
                More
              </span>
            </button>
          </div>
        </nav>
      </div>

      {/* More sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-sheet-title"
            className="absolute inset-x-0 bottom-0 animate-fade-up"
          >
            <div className="mx-auto max-w-lg rounded-t-3xl border border-graphite-border bg-graphite-surface shadow-panel pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="flex justify-center pt-3 pb-1" aria-hidden="true">
                <span className="w-10 h-1 rounded-full bg-white/15" />
              </div>
              <div className="flex items-center justify-between px-5 pb-3">
                <h2 id="more-sheet-title" className="text-base font-semibold text-ink font-display">
                  More
                </h2>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-graphite-surface-2"
                  aria-label="Close menu"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>

              <ul className="px-4 pb-2 grid grid-cols-2 gap-2.5">
                {moreItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActivePath(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMoreOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={`block h-full rounded-2xl border p-3.5 transition-colors ${
                          active
                            ? 'border-mint/30 bg-mint-dim'
                            : 'border-graphite-border-subtle bg-graphite-elevated/70 active:bg-graphite-surface-2'
                        }`}
                      >
                        <div
                          aria-hidden="true"
                          className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 ${
                            active ? 'bg-mint/15 text-mint' : 'bg-graphite-surface-2 text-ink-secondary'
                          }`}
                        >
                          <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                        </div>
                        <p className={`text-sm font-medium ${active ? 'text-mint' : 'text-ink'}`}>
                          {item.label}
                        </p>
                        <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">{item.hint}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
