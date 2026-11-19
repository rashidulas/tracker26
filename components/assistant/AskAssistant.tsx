'use client';

/**
 * "Ask about this": the assistant in a side panel (a bottom sheet on a
 * phone), opened from a page header or a card with that page, its filters and
 * the selected item attached (lib/assistant/context.ts).
 *
 * The panel is the same ChatPanel as /chat. Each opening starts a new
 * conversation, saved like any other, so it also appears in the chat list and
 * can be continued there ("Open in Chat").
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Sparkles, X } from 'lucide-react';
import Button from '@/components/Button';
import { getAskPanelData } from '@/app/assist/actions';
import { ASK_PAGE_NAMES, contextStarters, contextTitle, type AskContext, type AskPage } from '@/lib/assistant/context';
import { todayInAppTimeZone } from '@/lib/dates';
// The chat (AI SDK, Markdown, charts) is only downloaded when a panel is
// first opened, so the button costs the pages it sits on next to nothing.
const ChatPanel = dynamic(() => import('./ChatPanel'), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});

function PanelSkeleton() {
  return (
    <div className="space-y-3 p-6 animate-pulse" aria-busy="true" aria-label="Opening the assistant">
      <div className="h-7 w-2/3 rounded-lg bg-graphite-surface-2/70" />
      <div className="h-12 rounded-2xl bg-graphite-surface-2/70" />
      <div className="h-12 rounded-2xl bg-graphite-surface-2/70" />
    </div>
  );
}

/** A conversation id in the form the server accepts (lib/assistant/conversations.ts). */
function newConversationId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `ask${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

type PanelData = Awaited<ReturnType<typeof getAskPanelData>>;

const AskContextValue = createContext<{ open: (context: AskContext) => void } | undefined>(undefined);

export function useAskAssistant() {
  const value = useContext(AskContextValue);
  if (!value) throw new Error('useAskAssistant must be used within AskAssistantProvider');
  return value;
}

export function AskAssistantProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ id: string; context: AskContext } | null>(null);
  const [sent, setSent] = useState(false);
  const [data, setData] = useState<PanelData | null>(null);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await getAskPanelData());
    } catch {
      setFailed(true);
    }
  }, []);

  const open = useCallback(
    (context: AskContext) => {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setSent(false);
      setSession({ id: newConversationId(), context });
      // Accounts and categories may have changed since the last opening.
      void load();
    },
    [load]
  );

  const close = useCallback(() => {
    setSession(null);
    const target = returnFocus.current;
    if (target && document.contains(target)) target.focus();
  }, []);

  // Following a link in an answer leaves the page the panel was about.
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (session) openedOn.current = pathname;
    // Only when a panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);
  useEffect(() => {
    if (session && pathname !== openedOn.current) setSession(null);
  }, [pathname, session]);

  useEffect(() => {
    if (!session) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // A dialog on top of the panel (an approval is not one) handles its own Escape.
      if (event.key === 'Escape' && !document.querySelector('[data-modal-dialog]')) close();
    };
    document.addEventListener('keydown', onKey);
    // On a phone the sheet covers the page: keep the page from scrolling behind it.
    const phone = window.matchMedia('(max-width: 1023px)').matches;
    const previous = document.body.style.overflow;
    if (phone) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (phone) document.body.style.overflow = previous;
    };
  }, [session, close]);

  const value = useMemo(() => ({ open }), [open]);
  const title = session ? contextTitle(session.context) : '';
  const starters = useMemo(
    () => (session ? contextStarters(session.context).map((label) => ({ label, prompt: label, send: true })) : []),
    [session]
  );

  return (
    <AskContextValue.Provider value={value}>
      {children}
      {session && (
        <div className="fixed inset-0 z-[65] pointer-events-none">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm pointer-events-auto lg:hidden"
            onClick={close}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`Ask about ${title}`}
            tabIndex={-1}
            className="pointer-events-auto absolute inset-x-0 bottom-0 flex h-[88dvh] flex-col overflow-hidden rounded-t-3xl border border-graphite-border bg-graphite-surface shadow-panel animate-fade-up focus:outline-none lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:h-auto lg:w-[27rem] lg:rounded-none lg:border-y-0 lg:border-r-0"
          >
            <div className="flex justify-center pt-2.5 lg:hidden" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-white/15" />
            </div>
            <header className="flex shrink-0 items-center gap-2 border-b border-graphite-border-subtle px-4 py-2.5">
              <Sparkles size={16} className="shrink-0 text-mint" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold text-ink font-display">Ask about {title}</h2>
                <p className="truncate text-xs text-ink-muted">
                  {ASK_PAGE_NAMES[session.context.page]}
                  {Object.entries(session.context.filters ?? {})
                    .map(([key, v]) => ` · ${key} ${v}`)
                    .join('')}
                </p>
              </div>
              {sent && (
                <Link
                  href={`/chat/${session.id}`}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs text-ink-secondary hover:bg-graphite-surface-2 hover:text-ink"
                >
                  <ExternalLink size={13} aria-hidden="true" />
                  Open in Chat
                </Link>
              )}
              <button
                type="button"
                onClick={close}
                className="inline-flex h-11 w-11 -mr-2 items-center justify-center rounded-xl text-ink-muted hover:bg-graphite-surface-2 hover:text-ink"
                aria-label="Close the assistant"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1">
              {data ? (
                <ChatPanel
                  key={session.id}
                  conversationId={session.id}
                  initialMessages={[]}
                  starters={starters}
                  reference={data.reference}
                  today={data.today}
                  greeting={`Ask about ${title}`}
                  intro="I already know what you are looking at. Ask away."
                  context={session.context}
                  onChanged={(event) => event === 'sent' && setSent(true)}
                />
              ) : failed ? (
                <div className="space-y-3 p-6 text-center">
                  <p className="text-sm text-danger">The assistant could not be opened.</p>
                  <Button variant="secondary" size="sm" onClick={() => void load()}>
                    Try again
                  </Button>
                </div>
              ) : (
                <PanelSkeleton />
              )}
            </div>
          </div>
        </div>
      )}
    </AskContextValue.Provider>
  );
}

// ==================== BUTTONS ====================

/** The small assistant button on a card. */
export function AskButton({
  context,
  label,
  className = '',
}: {
  context: AskContext;
  /** What the button asks about, for its accessible name: "Dining Out budget". */
  label: string;
  className?: string;
}) {
  const ask = useAskAssistant();
  return (
    <button
      type="button"
      onClick={(event) => {
        // Cards are often clickable themselves.
        event.stopPropagation();
        event.preventDefault();
        ask.open(context);
      }}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-mint-dim hover:text-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40 ${className}`}
      aria-label={`Ask about ${label}`}
      title={`Ask about ${label}`}
    >
      <Sparkles size={15} aria-hidden="true" />
    </button>
  );
}

const PAGE_BY_PATH: Array<[string, AskPage]> = [
  ['/insights', 'insights'],
  ['/transactions/expenses', 'expenses'],
  ['/transactions/income', 'income'],
  ['/transactions/transfers', 'transfers'],
  ['/transactions/review', 'review'],
  ['/accounts', 'accounts'],
  ['/plan/budgets', 'budgets'],
  ['/plan/goals', 'goals'],
  ['/plan/recurring', 'recurring'],
  ['/friends', 'friends'],
];
/** Pages that show one month unless the URL says otherwise. */
const MONTH_PAGES: AskPage[] = ['expenses', 'income', 'transfers', 'budgets'];
const FILTER_PARAMS: Record<string, string> = { month: 'month', from: 'from', to: 'to', range: 'range' };

/** The page the user is on and the filters in its URL, as an assistant context. */
export function pageContext(pathname: string, search: string): AskContext | null {
  const page: AskPage | undefined =
    pathname === '/' ? 'dashboard' : PAGE_BY_PATH.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1];
  if (!page) return null;
  const params = new URLSearchParams(search);
  const filters: Record<string, string> = {};
  for (const [param, name] of Object.entries(FILTER_PARAMS)) {
    const value = params.get(param);
    if (value) filters[name] = value.slice(0, 40);
  }
  const hasRange = Boolean(filters.from || filters.to);
  if (MONTH_PAGES.includes(page) && !filters.month && !hasRange) filters.month = todayInAppTimeZone().slice(0, 7);
  if (filters.month === 'all') filters.month = 'all months';
  return { page, ...(Object.keys(filters).length > 0 ? { filters } : {}) };
}

/** The assistant button in a page header. Renders nothing on pages it knows nothing about. */
export function AskPageButton() {
  const ask = useAskAssistant();
  const pathname = usePathname();
  const context = pageContext(pathname, '');
  if (!context) return null;
  const name = ASK_PAGE_NAMES[context.page];
  return (
    <button
      type="button"
      // The URL is read on click: the lists keep their month in it without a navigation.
      onClick={() => ask.open(pageContext(pathname, window.location.search) ?? context)}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-graphite-border-subtle px-3 text-xs font-medium text-ink-secondary transition-colors hover:border-mint/40 hover:bg-mint-dim hover:text-mint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
      aria-label={`Ask the assistant about ${name}`}
    >
      <Sparkles size={13} aria-hidden="true" />
      Ask
    </button>
  );
}
