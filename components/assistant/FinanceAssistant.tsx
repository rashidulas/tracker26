'use client';

/**
 * The /chat page: the list of past chats (a column on wide screens, a drawer
 * on narrow ones) beside the current conversation (ChatPanel).
 *
 * The URL is the source of truth for which chat is open: /chat is a new
 * chat, /chat/<id> a stored one. Switching chats changes the URL with the
 * History API and loads the conversation from the API, so nothing is
 * re-rendered on the server and Back / Forward work.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { generateId } from 'ai';
import { Loader2, PanelLeft, SquarePen, X } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import type {
  ConversationSummary,
  LoadedConversation,
  StoredMessage,
} from '@/lib/assistant/conversations';
import type { ChatReference, StarterPrompt } from '@/lib/assistant/starters';
import type { DayString } from '@/lib/dates';
import ChatPanel from './ChatPanel';
import ConversationSidebar from './ConversationSidebar';

type Props = {
  conversations: ConversationSummary[];
  /** The conversation named in the URL, when it exists. */
  conversation: LoadedConversation | null;
  /** Id for a new chat, generated on the server so the first render matches. */
  freshId: string;
  starters: StarterPrompt[];
  reference: ChatReference;
  today: DayString;
  greeting: string;
};

type Active = {
  id: string;
  messages: StoredMessage[];
  running: boolean;
  /** False for a new chat nothing has been sent in yet. */
  stored: boolean;
};

const CHAT_PATH = '/chat';

function idFromPath(pathname: string): string | null {
  if (!pathname.startsWith(`${CHAT_PATH}/`)) return null;
  const id = decodeURIComponent(pathname.slice(CHAT_PATH.length + 1).split('/')[0]);
  return id || null;
}

/**
 * The height of the on-screen keyboard, as a CSS variable on the chat shell.
 * Phones do not shrink the layout viewport when the keyboard opens, so
 * without this the composer would sit behind it.
 */
function useKeyboardInset(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const el = ref.current;
    if (!viewport || !el) return;
    const update = () => {
      const inset = window.innerHeight - viewport.height - viewport.offsetTop;
      // Small differences are browser toolbars, not a keyboard.
      el.style.setProperty('--chat-keyboard', inset > 80 ? `${Math.round(inset)}px` : '0px');
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [ref]);
}

const headerButton =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-graphite-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40';

export default function FinanceAssistant({
  conversations: initialConversations,
  conversation,
  freshId,
  starters,
  reference,
  today,
  greeting,
}: Props) {
  const toast = useToast();
  const pathname = usePathname();
  const urlId = idFromPath(pathname);
  const rootRef = useRef<HTMLDivElement>(null);
  useKeyboardInset(rootRef);

  const [conversations, setConversations] = useState(initialConversations);
  // Deleted in the list, waiting out the Undo window.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<Active>(() =>
    conversation
      ? { id: conversation.id, messages: conversation.messages, running: conversation.running, stored: true }
      : { id: freshId, messages: [], running: false, stored: false }
  );
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const requestRef = useRef(0);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/assistant/conversations', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations);
    } catch {
      // The list is refreshed again after the next reply.
    }
  }, []);

  const startNew = useCallback(() => {
    requestRef.current += 1;
    setLoading(false);
    setActive({ id: generateId(), messages: [], running: false, stored: false });
  }, []);

  const open = useCallback(
    async (id: string) => {
      const request = (requestRef.current += 1);
      setLoading(true);
      let loaded: LoadedConversation | null = null;
      try {
        const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (res.ok) loaded = ((await res.json()) as { conversation: LoadedConversation }).conversation;
      } catch {
        // Handled below as "could not open".
      }
      if (request !== requestRef.current) return;
      setLoading(false);
      if (!loaded) {
        toast.info('That chat is not available any more');
        window.history.replaceState(null, '', CHAT_PATH);
        if (activeRef.current.stored) startNew();
        return;
      }
      setActive({ id: loaded.id, messages: loaded.messages, running: loaded.running, stored: true });
    },
    [startNew, toast]
  );

  // Follow the URL: links, Back / Forward, and the pushState calls below.
  useEffect(() => {
    const current = activeRef.current;
    if (urlId === null) {
      if (current.stored) startNew();
    } else if (urlId !== current.id) {
      void open(urlId);
    }
  }, [urlId, open, startNew]);

  const go = useCallback((id: string | null) => {
    setDrawerOpen(false);
    const path = id ? `${CHAT_PATH}/${encodeURIComponent(id)}` : CHAT_PATH;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  }, []);

  const onChanged = useCallback(
    (event: 'sent' | 'finished') => {
      const current = activeRef.current;
      if (event === 'sent') {
        if (!current.stored) {
          // The chat exists from its first message: give it its address and a row.
          setActive({ ...current, stored: true });
          window.history.replaceState(null, '', `${CHAT_PATH}/${encodeURIComponent(current.id)}`);
          setConversations((list) =>
            list.some((c) => c.id === current.id)
              ? list
              : [{ id: current.id, title: 'New chat', lastMessageAt: new Date().toISOString() }, ...list]
          );
        }
        setTimeout(() => void refreshList(), 1200);
        return;
      }
      void refreshList();
      // The generated title is written shortly after the first reply ends.
      setTimeout(() => void refreshList(), 4000);
    },
    [refreshList]
  );

  const onRename = useCallback(
    async (id: string, title: string) => {
      const before = conversations;
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, title } : c)));
      try {
        const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { conversation: ConversationSummary };
        setConversations((list) => list.map((c) => (c.id === id ? data.conversation : c)));
      } catch {
        setConversations(before);
        toast.error('Could not rename that chat');
      }
    },
    [conversations, toast]
  );

  const onDelete = useCallback(
    (target: ConversationSummary) => {
      const unhide = () =>
        setHidden((set) => {
          const next = new Set(set);
          next.delete(target.id);
          return next;
        });
      setHidden((set) => new Set(set).add(target.id));
      if (activeRef.current.id === target.id) go(null);
      toast.deferred({
        message: 'Chat deleted',
        errorMessage: 'Could not delete that chat',
        commit: async () => {
          const res = await fetch(`/api/assistant/conversations/${encodeURIComponent(target.id)}`, {
            method: 'DELETE',
          });
          return res.ok || res.status === 404
            ? { success: true }
            : { success: false, error: 'Could not delete that chat' };
        },
        onUndo: unhide,
        onCommitted: () => {
          setConversations((list) => list.filter((c) => c.id !== target.id));
          unhide();
        },
        onFailed: unhide,
      });
    },
    [go, toast]
  );

  // The drawer is a modal dialog: Escape closes it, focus stays inside and returns to the button.
  useEffect(() => {
    if (!drawerOpen) return;
    const trigger = drawerButtonRef.current;
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return setDrawerOpen(false);
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href]')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [drawerOpen]);

  const visible = conversations.filter((c) => !hidden.has(c.id));
  const title = active.stored ? visible.find((c) => c.id === active.id)?.title ?? 'Chat' : 'New chat';
  const sidebar = (
    <ConversationSidebar
      conversations={visible}
      activeId={active.stored ? active.id : null}
      today={today}
      onSelect={go}
      onNew={() => go(null)}
      onRename={onRename}
      onDelete={onDelete}
    />
  );

  return (
    <div ref={rootRef} className="chat-shell fixed inset-x-0 z-30 flex">
      <aside className="hidden w-72 shrink-0 border-r border-graphite-border-subtle bg-graphite-elevated/60 xl:block">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-graphite-border-subtle px-1.5 xl:px-5">
          <button
            ref={drawerButtonRef}
            type="button"
            onClick={() => setDrawerOpen(true)}
            className={`${headerButton} xl:hidden`}
            aria-label="Show chats"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
          >
            <PanelLeft size={19} aria-hidden="true" />
          </button>
          <h1 className="min-w-0 flex-1 truncate px-1 text-[15px] font-medium text-ink">{title}</h1>
          <button type="button" onClick={() => go(null)} className={`${headerButton} xl:hidden`} aria-label="New chat">
            <SquarePen size={18} aria-hidden="true" />
          </button>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center" role="status">
            <Loader2 size={20} className="animate-spin text-ink-muted" aria-hidden="true" />
            <span className="sr-only">Opening chat…</span>
          </div>
        ) : (
          <ChatPanel
            key={active.id}
            conversationId={active.id}
            initialMessages={active.messages}
            initiallyRunning={active.running}
            starters={starters}
            reference={reference}
            today={today}
            greeting={greeting}
            onChanged={onChanged}
          />
        )}
      </div>

      {/* In a portal: the shell is its own stacking context, and the drawer has
          to cover the app's header and tab bar, which sit above the shell. */}
      {drawerOpen &&
        createPortal(
          <div className="fixed inset-0 z-[60] xl:hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-black/55 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
            />
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Chats"
              className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col border-r border-graphite-border bg-graphite-surface pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-panel"
            >
              <div className="flex items-center justify-between pl-5 pr-2 pt-2">
                <p className="font-display text-base font-semibold text-ink">Chats</p>
                <button type="button" onClick={() => setDrawerOpen(false)} className={headerButton} aria-label="Close chats">
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1">{sidebar}</div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
