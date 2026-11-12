'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  href: string;
  label: string;
  /** Match only the exact path (for index tabs such as "/"). */
  exact?: boolean;
}

/**
 * Section-level tabs that are real routes. Rendered as a nav of links with
 * aria-current, which works with the browser's back button and deep links.
 */
export default function TabNav({ tabs, label }: { tabs: Tab[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="mb-6 -mx-1 px-1 overflow-x-auto scrollbar-none">
      <ul className="inline-flex items-center gap-1 p-1 rounded-2xl bg-graphite-surface-2/90 border border-graphite-border-subtle min-w-full sm:min-w-0">
        {tabs.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href} className="flex-1 sm:flex-initial">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center justify-center min-h-[44px] px-4 rounded-xl text-sm font-medium whitespace-nowrap transition-colors duration-200 ${
                  active
                    ? 'bg-mint text-graphite shadow-[0_0_18px_-6px_var(--mint-glow)]'
                    : 'text-ink-secondary hover:text-ink hover:bg-white/[0.03]'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
