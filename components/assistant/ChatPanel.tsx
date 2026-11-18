'use client';

/**
 * One conversation with the assistant: the message column and the composer.
 *
 * It fills whatever box it is placed in and knows nothing about the page
 * around it, so it can be mounted anywhere (the /chat page today, a drawer
 * on another page later). Give it a conversation id and that conversation's
 * stored messages; it talks to /api/assistant/chat itself.
 *
 * The server keeps the history (lib/assistant/chat.ts). Each request sends
 * only the newest message, plus any changes made on an approval card.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import { ArrowDown, Check, Copy, ImagePlus, Pencil, RotateCcw, TriangleAlert } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { OUT_OF_SYNC, type StoredMessage } from '@/lib/assistant/conversations';
import type { AssistantUIMessage } from '@/lib/assistant/engine';
import { followUpsFor } from '@/lib/assistant/followUps';
import type { ChatReference, StarterPrompt } from '@/lib/assistant/starters';
import type { ProposalEdit } from '@/lib/assistant/write';
import type { DayString } from '@/lib/dates';
import Composer, { type ComposerHandle, type ComposerImage } from './Composer';
import Markdown from './Markdown';
import ProposalCard, { isWritePart, type WritePart } from './ProposalCard';
import ToolActivity from './ToolActivity';
import { useStickToBottom } from './useStickToBottom';

// Charts pull in recharts; load them only when an answer has something to draw.
const ToolResult = dynamic(() => import('./ToolResults'), { ssr: false });

type Part = AssistantUIMessage['parts'][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

export type ChatPanelProps = {
  conversationId: string;
  /** The conversation as stored; empty for a new chat. */
  initialMessages: StoredMessage[];
  /** A reply was still being produced when the conversation was loaded. */
  initiallyRunning?: boolean;
  /** Suggested first messages for an empty chat. */
  starters: StarterPrompt[];
  /** Accounts and categories, for editing a proposal on its card. */
  reference: ChatReference;
  /** Today in the app's timezone. */
  today: DayString;
  greeting: string;
  /** 'sent': a message went out (the chat now exists). 'finished': a reply ended. */
  onChanged?: (event: 'sent' | 'finished') => void;
};

const textOf = (message: AssistantUIMessage) =>
  message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('\n\n')
    .trim();

const hasSavedWrite = (message: AssistantUIMessage) =>
  message.parts.some((part) => isWritePart(part) && part.state === 'output-available');

/** The server's message when a request is refused, from the error useChat reports. */
function serverMessage(error: Error): string | null {
  try {
    const body = JSON.parse(error.message) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/** Enough of a conversation to tell whether the stored copy differs from the one on screen. */
const fingerprint = (messages: { id: string; parts: unknown[] }[]) =>
  messages
    .map((m) => `${m.id}:${(m.parts as { type?: string; state?: string }[]).map((p) => p.state ?? p.type).join(',')}`)
    .join('|');

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard permission, or not a secure context (http on the local network).
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

const actionButton =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-graphite-surface-2 hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40';

// Actions stay out of the way on a pointer device until the message is
// hovered or focused; on touch there is no hover, so they are always shown.
const quietActions =
  'opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={actionButton}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async () => setCopied(await copyText(text))}
    >
      {copied ? <Check size={15} className="text-mint" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    </button>
  );
}

// ==================== MESSAGES ====================

type UserMessageProps = {
  message: AssistantUIMessage;
  /** Why this message cannot be edited, or null when it can. */
  editBlocked: string | null;
  busy: boolean;
  onEdit: (message: AssistantUIMessage, text: string) => void;
};

const UserMessage = memo(function UserMessage({ message, editBlocked, busy, onEdit }: UserMessageProps) {
  const text = textOf(message);
  const images = message.parts.filter(
    (part): part is Extract<Part, { type: 'file' }> => part.type === 'file' && part.mediaType.startsWith('image/')
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!editing || !el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [editing, draft]);

  const submit = () => {
    const next = draft.trim();
    if (!next && images.length === 0) return;
    setEditing(false);
    onEdit(message, next);
  };

  if (editing) {
    return (
      <li className="flex justify-end">
        <form
          className="w-full rounded-3xl border border-mint/40 bg-graphite-surface p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={areaRef}
            autoFocus
            value={draft}
            rows={1}
            aria-label="Edit your message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false);
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            className="block w-full resize-none bg-transparent px-1 text-base leading-6 text-ink focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-ink-muted">Sending replaces everything after this message.</p>
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!draft.trim() && images.length === 0}>
                Send
              </Button>
            </div>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="group/message flex flex-col items-end">
      {images.length > 0 && (
        <div className="mb-1.5 flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {images.map((image, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={image.url}
              alt={`Image ${index + 1} you sent`}
              className="max-h-48 max-w-[11rem] rounded-2xl border border-graphite-border object-cover"
            />
          ))}
        </div>
      )}
      {text && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-graphite-surface-2 px-4 py-2.5 text-[15px] leading-6 text-ink sm:text-base">
          {text}
        </div>
      )}
      <div className={`mt-0.5 flex ${quietActions}`}>
        {text && <CopyButton text={text} label="Copy message" />}
        <button
          type="button"
          className={actionButton}
          disabled={busy || editBlocked !== null}
          aria-label="Edit and resend"
          title={editBlocked ?? 'Edit and resend'}
          onClick={() => {
            setDraft(text);
            setEditing(true);
          }}
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
});

type AssistantMessageProps = {
  message: AssistantUIMessage;
  isLast: boolean;
  /** This message is being written right now. */
  streaming: boolean;
  busy: boolean;
  reference: ChatReference;
  today: DayString;
  followUps: StarterPrompt[];
  onApprove: (part: WritePart, edit: ProposalEdit | null) => void;
  onDismiss: (part: WritePart) => void;
  onRegenerate: (message: AssistantUIMessage) => void;
  onSuggestion: (suggestion: StarterPrompt) => void;
};

const AssistantMessage = memo(function AssistantMessage({
  message,
  isLast,
  streaming,
  busy,
  reference,
  today,
  followUps,
  onApprove,
  onDismiss,
  onRegenerate,
  onSuggestion,
}: AssistantMessageProps) {
  const text = textOf(message);
  const readTools = message.parts.filter((part): part is ToolPart => isToolUIPart(part) && !isWritePart(part));
  const lastTextIndex = message.parts.map((part) => part.type).lastIndexOf('text');
  const body = message.parts.map((part, index) => {
    if (part.type === 'text') {
      return part.text.trim() ? (
        <Markdown key={index} text={part.text} streaming={streaming && index === lastTextIndex} />
      ) : null;
    }
    if (isWritePart(part)) {
      return (
        <ProposalCard
          key={part.toolCallId}
          part={part}
          reference={reference}
          superseded={!isLast}
          busy={busy}
          onApprove={(edit) => onApprove(part, edit)}
          onDismiss={() => onDismiss(part)}
        />
      );
    }
    if (isToolUIPart(part)) return <ToolResult key={part.toolCallId} part={part} today={today} />;
    return null;
  });

  // Not while a card is waiting: the card is the next thing to deal with.
  const awaitingDecision = message.parts.some(
    (part) => isWritePart(part) && part.state === 'approval-requested' && !part.approval.isAutomatic
  );
  const canRegenerate = isLast && !streaming && !hasSavedWrite(message) && !awaitingDecision;
  // A reply that was stopped before it wrote anything leaves nothing to show.
  if (!streaming && body.every((node) => node === null) && readTools.length === 0) return null;
  return (
    <li className="group/message min-w-0">
      <ToolActivity parts={readTools} today={today} />
      {body}
      {!streaming && (
        <div className={`mt-1 flex -ml-2 ${isLast ? '' : quietActions}`}>
          {text && <CopyButton text={text} label="Copy reply" />}
          {canRegenerate && (
            <button
              type="button"
              className={actionButton}
              disabled={busy}
              aria-label="Regenerate reply"
              title="Regenerate reply"
              onClick={() => onRegenerate(message)}
            >
              <RotateCcw size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {followUps.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Suggested follow-ups">
          {followUps.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => onSuggestion(item)}
                className="min-h-[40px] rounded-full border border-graphite-border bg-graphite-surface px-3.5 text-left text-sm text-ink-secondary transition-colors hover:border-mint/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});

function Thinking({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 py-1 text-sm text-ink-muted">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-mint"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      {label}
    </li>
  );
}

// ==================== PANEL ====================

export default function ChatPanel({
  conversationId,
  initialMessages,
  initiallyRunning = false,
  starters,
  reference,
  today,
  greeting,
  onChanged,
}: ChatPanelProps) {
  const toast = useToast();
  const router = useRouter();
  const composerRef = useRef<ComposerHandle>(null);
  const [catchingUp, setCatchingUp] = useState(initiallyRunning);
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState(false);

  // Changes made on approval cards, by tool call id. Kept until the page is
  // left, so a request that has to be retried carries the same changes.
  const editsRef = useRef<Record<string, ProposalEdit>>({});
  // Bumped whenever the user acts, so a slower background refresh cannot overwrite it.
  const generationRef = useRef(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const syncRef = useRef<() => Promise<void>>(async () => {});

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUIMessage>({
        api: '/api/assistant/chat',
        prepareSendMessagesRequest: ({ id, messages }) => {
          const message = messages[messages.length - 1];
          const proposalEdits: Record<string, ProposalEdit> = {};
          for (const part of message?.parts ?? []) {
            if (isToolUIPart(part) && part.state === 'approval-responded' && editsRef.current[part.toolCallId]) {
              proposalEdits[part.toolCallId] = editsRef.current[part.toolCallId];
            }
          }
          return { body: { id, message, proposalEdits } };
        },
      }),
    []
  );

  const { messages, sendMessage, regenerate, stop, setMessages, addToolApprovalResponse, status, error, clearError } =
    useChat<AssistantUIMessage>({
      id: conversationId,
      messages: initialMessages as AssistantUIMessage[],
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      throttle: 60,
      onError: (failure) => {
        const message = serverMessage(failure);
        if (message === OUT_OF_SYNC) {
          toast.info(message);
          void syncRef.current();
        } else {
          toast.error(message ?? 'The assistant could not answer. Please try again.');
        }
      },
      onFinish: ({ message, isAbort, isError, isDisconnect }) => {
        onChangedRef.current?.('finished');
        if (isAbort || isError || isDisconnect) return;
        setAnnouncement(`Assistant: ${textOf(message).slice(0, 400) || 'replied.'}`);
        // Something was recorded: let the rest of the app pick it up.
        if (message.parts.some((p) => isWritePart(p) && p.state === 'output-available' && !p.output.alreadySaved)) {
          router.refresh();
        }
      },
    });
  const busy = status === 'submitted' || status === 'streaming';
  const { scrollRef, contentRef, atBottom, scrollToBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>(
    messages.length > 0
  );
  const statusRef = useRef(status);
  statusRef.current = status;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  /**
   * Bring the screen in line with what the server has stored, waiting for a
   * reply that is still being produced (the tab was closed or the phone
   * locked mid-reply, or a reply was just stopped).
   */
  const sync = useCallback(async () => {
    const generation = generationRef.current;
    for (let attempt = 0; attempt < 45; attempt++) {
      let conversation: { running: boolean; messages: StoredMessage[] };
      try {
        const res = await fetch(`/api/assistant/conversations/${conversationId}`, { cache: 'no-store' });
        if (!res.ok) break;
        conversation = (await res.json()).conversation;
      } catch {
        break;
      }
      const idle = statusRef.current === 'ready' || statusRef.current === 'error';
      if (generation !== generationRef.current || !idle) break;
      if (!conversation.running) {
        if (fingerprint(conversation.messages) !== fingerprint(messagesRef.current)) {
          setMessages(conversation.messages as AssistantUIMessage[]);
        }
        if (statusRef.current === 'error' && conversation.messages.at(-1)?.role === 'assistant') clearError();
        break;
      }
      setCatchingUp(true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (generation === generationRef.current) setCatchingUp(false);
  }, [clearError, conversationId, setMessages]);
  syncRef.current = sync;

  useEffect(() => {
    if (initiallyRunning) void sync();
    // Only on mount: later refreshes are driven by the events below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back to the tab (or unlocking the phone): a reply may have finished meanwhile.
  useEffect(() => {
    const onVisible = () => {
      const idle = statusRef.current === 'ready' || statusRef.current === 'error';
      if (document.visibilityState === 'visible' && idle && messagesRef.current.length > 0) void sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [sync]);

  useEffect(() => {
    if (status === 'submitted') setAnnouncement('The assistant is working on a reply.');
    if (status === 'error') setAnnouncement('The assistant could not answer.');
  }, [status]);

  // ---- actions ----

  const act = useCallback(() => {
    generationRef.current += 1;
    setCatchingUp(false);
    if (statusRef.current === 'error') clearError();
    onChangedRef.current?.('sent');
    requestAnimationFrame(() => scrollToBottom());
  }, [clearError, scrollToBottom]);

  const send = useCallback(
    ({ text, images }: { text: string; images: ComposerImage[] }) => {
      if (statusRef.current === 'submitted' || statusRef.current === 'streaming') return;
      const files = images.map((image) => ({ type: 'file' as const, mediaType: image.mediaType, url: image.url }));
      act();
      void sendMessage(text ? { text, files } : { files });
    },
    [act, sendMessage]
  );

  const onSuggestion = useCallback(
    (suggestion: StarterPrompt) => {
      if (suggestion.send) send({ text: suggestion.prompt, images: [] });
      else composerRef.current?.setText(suggestion.prompt);
    },
    [send]
  );

  const onEdit = useCallback(
    (message: AssistantUIMessage, text: string) => {
      const files = message.parts.filter((part): part is Extract<Part, { type: 'file' }> => part.type === 'file');
      act();
      void sendMessage(text ? { text, files, messageId: message.id } : { files, messageId: message.id });
    },
    [act, sendMessage]
  );

  const onRegenerate = useCallback(
    (message?: AssistantUIMessage) => {
      act();
      void regenerate(message ? { messageId: message.id } : undefined);
    },
    [act, regenerate]
  );

  const onApprove = useCallback(
    (part: WritePart, edit: ProposalEdit | null) => {
      if (part.state !== 'approval-requested') return;
      if (edit) editsRef.current[part.toolCallId] = edit;
      else delete editsRef.current[part.toolCallId];
      generationRef.current += 1;
      void addToolApprovalResponse({ id: part.approval.id, approved: true });
    },
    [addToolApprovalResponse]
  );

  const onDismiss = useCallback(
    (part: WritePart) => {
      if (part.state !== 'approval-requested') return;
      delete editsRef.current[part.toolCallId];
      generationRef.current += 1;
      void addToolApprovalResponse({ id: part.approval.id, approved: false });
    },
    [addToolApprovalResponse]
  );

  const stopReply = useCallback(async () => {
    generationRef.current += 1;
    // Tell the server to stop the model call (it keeps what was written so
    // far); stopping only the request would leave the reply running there.
    await Promise.allSettled([
      fetch('/api/assistant/chat/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: conversationId }),
      }),
      stop(),
    ]);
    await syncRef.current();
  }, [conversationId, stop]);

  // ---- drag and drop ----

  const dragDepth = useRef(0);
  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');

  // ---- render ----

  const lastMessage = messages[messages.length - 1];
  const followUps = useMemo(
    () => (status === 'ready' && !catchingUp ? followUpsFor(lastMessage) : []),
    [status, catchingUp, lastMessage]
  );
  // Editing or regenerating would drop a message whose transaction is already
  // recorded, and invite the same thing being proposed and saved again.
  const firstSaved = messages.findIndex(hasSavedWrite);
  const lastRendersNothingYet =
    lastMessage?.role === 'assistant' &&
    !lastMessage.parts.some(
      (part) =>
        (part.type === 'text' && part.text.trim() !== '') ||
        (isToolUIPart(part) && part.state !== 'output-error' && !(part.state === 'output-denied' && part.approval.isAutomatic))
    );
  const showThinking = busy && (lastMessage?.role !== 'assistant' || lastRendersNothingYet);
  const needsRetry = !busy && !catchingUp && (status === 'error' || lastMessage?.role === 'user');

  return (
    <section
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
      aria-label="Conversation"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        composerRef.current?.addFiles(event.dataTransfer.files);
      }}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]">
        <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-6 pt-5 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col justify-center py-6">
              <h2 className="text-balance font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {greeting}
              </h2>
              <p className="mt-2 text-base text-ink-secondary">
                Ask about your money, or tell me what you spent and I’ll draft it for you to approve.
              </p>
              <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {starters.map((starter, index) => (
                  // A phone shows the first three and the last ("Log an expense").
                  <li
                    key={starter.label}
                    className={index >= 3 && index < starters.length - 1 ? 'hidden sm:block' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => onSuggestion(starter)}
                      className="flex min-h-[52px] w-full items-center rounded-2xl border border-graphite-border-subtle bg-graphite-surface px-4 py-3 text-left text-[15px] text-ink-secondary transition-colors hover:border-mint/40 hover:bg-graphite-surface-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40"
                    >
                      {starter.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="space-y-5">
              {messages.map((message, index) => {
                const isLast = index === messages.length - 1;
                if (message.role === 'user') {
                  return (
                    <UserMessage
                      key={message.id}
                      message={message}
                      busy={busy}
                      editBlocked={
                        firstSaved >= 0 && index <= firstSaved
                          ? 'Something was saved after this message, so it can no longer be edited'
                          : null
                      }
                      onEdit={onEdit}
                    />
                  );
                }
                if (message.role !== 'assistant') return null;
                return (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    isLast={isLast}
                    streaming={isLast && busy}
                    busy={busy}
                    reference={reference}
                    today={today}
                    followUps={isLast ? followUps : []}
                    onApprove={onApprove}
                    onDismiss={onDismiss}
                    onRegenerate={onRegenerate}
                    onSuggestion={onSuggestion}
                  />
                );
              })}
              {showThinking && <Thinking label="Thinking…" />}
              {catchingUp && !busy && <Thinking label="Still working on a reply…" />}
              {needsRetry && (
                <li
                  className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm text-ink ${
                    status === 'error'
                      ? 'border-danger/25 bg-danger-dim'
                      : 'border-graphite-border-subtle bg-graphite-surface'
                  }`}
                  role={status === 'error' ? 'alert' : undefined}
                >
                  {status === 'error' && (
                    <TriangleAlert size={16} className="shrink-0 text-danger" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    {status === 'error' ? 'That did not go through.' : 'This message has no reply yet.'}
                  </span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => onRegenerate()}>
                    <RotateCcw size={14} aria-hidden="true" /> Try again
                  </Button>
                </li>
              )}
            </ol>
          )}
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-3xl shrink-0 px-3 pb-3 sm:px-6">
        {!atBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute -top-12 left-1/2 inline-flex min-h-[40px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-graphite-border bg-graphite-surface-2 px-3.5 text-sm text-ink shadow-panel hover:bg-graphite-surface-hover"
          >
            <ArrowDown size={15} aria-hidden="true" /> Jump to latest
          </button>
        )}
        <Composer ref={composerRef} busy={busy} onSend={send} onStop={stopReply} />
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-mint/50 bg-graphite/80 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-base text-ink">
            <ImagePlus size={18} className="text-mint" aria-hidden="true" /> Drop images to attach them
          </p>
        </div>
      )}
    </section>
  );
}
