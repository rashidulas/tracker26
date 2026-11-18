'use client';

/**
 * The list of past chats, grouped by date, with a "New chat" button and
 * rename / delete on each row. Rendered as a column on wide screens and
 * inside a drawer on narrow ones (FinanceAssistant.tsx).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, SquarePen, Trash2 } from 'lucide-react';
import { groupConversations } from '@/lib/assistant/conversationGroups';
import { MAX_TITLE_LENGTH, type ConversationSummary } from '@/lib/assistant/conversations';
import type { DayString } from '@/lib/dates';

type Props = {
  conversations: ConversationSummary[];
  activeId: string | null;
  today: DayString;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (conversation: ConversationSummary) => void;
};

function Row({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(conversation.title);
  const rowRef = useRef<HTMLLIElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const finishRename = (save: boolean) => {
    const title = draft.replace(/\s+/g, ' ').trim();
    setRenaming(false);
    if (save && title && title !== conversation.title) onRename(title);
  };

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          value={draft}
          maxLength={MAX_TITLE_LENGTH}
          aria-label="Chat name"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={() => finishRename(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finishRename(true);
            if (event.key === 'Escape') finishRename(false);
          }}
          className="w-full rounded-xl border border-mint/50 bg-graphite-surface-2 px-3 py-2.5 text-base text-ink focus:outline-none focus:ring-2 focus:ring-mint/30 lg:text-sm"
        />
      </li>
    );
  }

  return (
    <li ref={rowRef} className="group/row relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        className={`flex min-h-[44px] w-full items-center rounded-xl py-2 pl-3 pr-11 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40 ${
          active ? 'bg-mint-dim text-ink' : 'text-ink-secondary hover:bg-graphite-surface-2 hover:text-ink'
        }`}
      >
        <span className="truncate">{conversation.title}</span>
      </button>
      <button
        ref={menuButtonRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-label={`Options for ${conversation.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted hover:bg-graphite-surface-hover hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 ${
          menuOpen || active ? '!opacity-100' : ''
        }`}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-1 top-full z-20 mt-1 w-40 overflow-hidden rounded-xl border border-graphite-border bg-graphite-surface-2 py-1 shadow-panel"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setDraft(conversation.title);
              setRenaming(true);
            }}
            className="flex min-h-[40px] w-full items-center gap-2.5 px-3 text-left text-sm text-ink hover:bg-graphite-surface-hover"
          >
            <Pencil size={14} aria-hidden="true" className="text-ink-muted" /> Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="flex min-h-[40px] w-full items-center gap-2.5 px-3 text-left text-sm text-danger hover:bg-danger-dim"
          >
            <Trash2 size={14} aria-hidden="true" /> Delete
          </button>
        </div>
      )}
    </li>
  );
}

export default function ConversationSidebar({
  conversations,
  activeId,
  today,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const groups = useMemo(() => groupConversations(conversations, today), [conversations, today]);
  return (
    <nav aria-label="Chats" className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-3">
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl border border-graphite-border bg-graphite-surface-2 px-3 text-sm font-medium text-ink transition-colors hover:bg-graphite-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
        >
          <SquarePen size={16} aria-hidden="true" className="text-mint" /> New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-sm text-ink-muted">Your chats will be listed here.</p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="mt-3 first:mt-1">
              <h2 className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {group.items.map((conversation) => (
                  <Row
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeId}
                    onSelect={() => onSelect(conversation.id)}
                    onRename={(title) => onRename(conversation.id, title)}
                    onDelete={() => onDelete(conversation)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}
