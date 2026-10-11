'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, TrendingDown, TrendingUp } from 'lucide-react';

const views = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/expenses-dashboard', label: 'Expenses', icon: TrendingDown },
  { href: '/income-dashboard', label: 'Income', icon: TrendingUp },
] as const;

export default function DashboardViewSwitcher() {
  const pathname = usePathname();

  return (
    <div className="w-full sm:w-auto overflow-x-auto -mx-1 px-1 scrollbar-none">
      <div
        className="inline-flex items-center gap-1 p-1 rounded-2xl bg-graphite-surface-2/90 border border-graphite-border-subtle shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] min-w-full sm:min-w-0"
        role="tablist"
        aria-label="Dashboard views"
      >
        {views.map((view) => {
          const Icon = view.icon;
          const active =
            view.href === '/dashboard'
              ? pathname === '/dashboard' || pathname === '/'
              : pathname === view.href || pathname.startsWith(`${view.href}/`);

          return (
            <Link
              key={view.href}
              href={view.href}
              role="tab"
              aria-selected={active}
              className={`relative inline-flex flex-1 sm:flex-initial items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap ${
                active
                  ? 'bg-mint text-graphite shadow-[0_0_18px_-6px_var(--mint-glow)]'
                  : 'text-ink-muted hover:text-ink hover:bg-white/[0.03]'
              }`}
            >
              <Icon size={15} strokeWidth={active ? 2.4 : 1.9} />
              <span>{view.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
