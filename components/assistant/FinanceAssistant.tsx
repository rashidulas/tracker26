'use client';

/**
 * Chat with the finance assistant (engine: app/api/assistant/chat, lib/assistant).
 *
 * Minimal rendering on top of useChat: text, images, a short line while tools
 * run, and an approve / discard card for proposed expenses and income. The
 * full interface is still to come.
 */
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Send, X } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import type { AssistantUIMessage } from '@/lib/assistant/engine';
import type { SaveResult } from '@/lib/assistant/write';

type Part = AssistantUIMessage['parts'][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

const WELCOME =
  'Hey — ask me anything about your accounts, spending, income, budgets, goals or friends. Or say something like “I spent $42 on groceries at Walmart” and I’ll propose it for you to approve.';

const TOOL_LABELS: Record<string, string> = {
  searchTransactions: 'Searching transactions',
  summarizeTransactions: 'Adding up transactions',
  comparePeriods: 'Comparing periods',
  accountBalances: 'Checking balances',
  budgetStatus: 'Checking budgets',
  goalProgress: 'Checking goals',
  friendBalances: 'Checking friends',
  upcomingRecurring: 'Looking for upcoming bills',
};

const isWriteTool = (type: string) => type === 'tool-createExpense' || type === 'tool-createIncome';

export default function FinanceAssistant({
  variant = 'card',
}: {
  /** @deprecated use variant */
  embedded?: boolean;
  variant?: 'card' | 'page' | 'embedded';
}) {
  const isPage = variant === 'page';
  const isEmbedded = variant === 'embedded';
  const { error: toastError } = useToast();
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<{
    dataUrl: string;
    mimeType: string;
  } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const { messages, sendMessage, addToolApprovalResponse, status, error, clearError } =
    useChat<AssistantUIMessage>({
      transport: new DefaultChatTransport({ api: '/api/assistant/chat' }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onError: () => toastError('The assistant could not answer. Please try again.'),
    });
  const isSending = status === 'submitted' || status === 'streaming';

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const holdStartedRef = useRef(false);
  const pendingImageRef = useRef(pendingImage);
  const sendRef = useRef<
    (payload: {
      text: string;
      image?: { dataUrl: string; mimeType: string } | null;
    }) => Promise<void>
  >(async () => {});

  useEffect(() => {
    pendingImageRef.current = pendingImage;
  }, [pendingImage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      stopRecording();
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, [stopRecording]);

  const sendToAssistant = useCallback(
    async (payload: {
      text: string;
      image?: { dataUrl: string; mimeType: string } | null;
    }) => {
      const text = payload.text.trim();
      if ((!text && !payload.image) || isSending) return;
      if (error) clearError();
      setInput('');
      setPendingImage(null);
      const files = payload.image
        ? [{ type: 'file' as const, mediaType: payload.image.mimeType, url: payload.image.dataUrl }]
        : undefined;
      await sendMessage(
        text ? { text, files } : { files: files!, metadata: undefined }
      );
    },
    [clearError, error, isSending, sendMessage]
  );

  sendRef.current = sendToAssistant;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 500) return;

        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append(
            'audio',
            blob,
            `speech.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`
          );
          const res = await fetch('/api/assistant/transcribe', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Transcription failed');
          }
          await sendRef.current({ text: data.text, image: pendingImageRef.current });
        } catch (err) {
          toastError(err instanceof Error ? err.message : 'Could not transcribe audio');
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      toastError('Microphone permission is required for voice input');
      setIsRecording(false);
    }
  };

  const onOrbPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (isSending || isTranscribing) return;
    holdStartedRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    void startRecording();
  };

  const onOrbPointerUp = (e: React.PointerEvent) => {
    if (!holdStartedRef.current) return;
    holdStartedRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    stopRecording();
  };

  const onPickImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toastError('Please upload an image');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toastError('Image must be under 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage({
        dataUrl: reader.result as string,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const lastMessageId = messages[messages.length - 1]?.id;

  const renderToolPart = (part: ToolPart, messageId: string) => {
    const key = part.toolCallId;
    if (!isWriteTool(part.type)) {
      if (part.state === 'input-streaming' || part.state === 'input-available') {
        return (
          <p key={key} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Loader2 size={11} className="animate-spin" />
            {TOOL_LABELS[part.type.slice(5)] ?? 'Looking that up'}…
          </p>
        );
      }
      return null;
    }

    const kind = part.type === 'tool-createIncome' ? 'Income' : 'Expense';
    switch (part.state) {
      case 'input-streaming':
      case 'input-available':
        return (
          <p key={key} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Loader2 size={11} className="animate-spin" /> Preparing {kind.toLowerCase()}…
          </p>
        );
      case 'approval-requested': {
        if (part.approval.isAutomatic) return null;
        // A newer message means this card was skipped; the server treats it as not approved.
        const stale = messageId !== lastMessageId;
        return (
          <div
            key={key}
            className="mt-2.5 rounded-xl border border-graphite-border bg-graphite-elevated/90 p-2.5 space-y-1.5"
          >
            <span
              className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                kind === 'Income' ? 'text-mint' : 'text-danger'
              }`}
            >
              {kind} to approve
            </span>
            <p className="text-[13px] text-ink">{part.approval.requestReason}</p>
            {stale ? (
              <p className="text-[11px] text-ink-muted">Not saved.</p>
            ) : (
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  disabled={isSending}
                  onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}
                >
                  <Check size={14} /> Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  disabled={isSending}
                  onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false })}
                >
                  Discard
                </Button>
              </div>
            )}
          </div>
        );
      }
      case 'approval-responded':
        return (
          <p key={key} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            {part.approval.approved ? (
              <>
                <Loader2 size={11} className="animate-spin" /> Saving…
              </>
            ) : (
              'Discarded.'
            )}
          </p>
        );
      case 'output-available':
        return (
          <p key={key} className="flex items-center gap-1.5 text-[11px] text-mint">
            <Check size={12} /> Saved: {(part.output as SaveResult).summary}
          </p>
        );
      case 'output-denied':
        // Automatic denials are proposals the server rejected; the model fixes those.
        return part.approval.isAutomatic ? null : (
          <p key={key} className="text-[11px] text-ink-muted">
            {kind} not saved.
          </p>
        );
      case 'output-error':
        return (
          <p key={key} className="text-[11px] text-danger">
            Couldn’t save that {kind.toLowerCase()}.
          </p>
        );
      default:
        return null;
    }
  };

  const statusLabel = isRecording
    ? 'Listening… release to send'
    : isTranscribing
      ? 'Transcribing…'
      : isSending
        ? 'Thinking…'
        : 'Hold to talk · or type below';

  const orb = (
    <div className={`flex flex-col items-center justify-center gap-2 ${isPage ? 'sm:min-w-[120px]' : 'sm:min-w-[140px]'} py-1`}>
      <button
        type="button"
        onPointerDown={onOrbPointerDown}
        onPointerUp={onOrbPointerUp}
        onPointerCancel={onOrbPointerUp}
        onPointerLeave={(e) => {
          if (holdStartedRef.current) onOrbPointerUp(e);
        }}
        disabled={isSending || isTranscribing}
        className={`siri-orb touch-none select-none ${isPage ? '' : 'siri-orb--mobile'} ${
          isRecording ? 'siri-orb--listening' : ''
        } ${isTranscribing || isSending ? 'siri-orb--busy' : ''}`}
        aria-label="Hold to talk"
      >
        <span className="siri-orb__ring siri-orb__ring--a" />
        <span className="siri-orb__ring siri-orb__ring--b" />
        <span className="siri-orb__core" />
      </button>
      <p className="text-[11px] text-ink-muted text-center leading-snug max-w-[9rem]">
        {isRecording ? 'Release to send' : 'Hold & speak'}
      </p>
    </div>
  );

  const bubble = (role: 'user' | 'assistant') =>
    `max-w-[92%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
      role === 'user'
        ? 'bg-mint-dim text-ink border border-mint/20'
        : 'bg-graphite-surface-2 text-ink-secondary border border-graphite-border-subtle'
    }`;

  const messageList = (
    <div
      className={`overflow-y-auto rounded-xl border border-graphite-border-subtle bg-graphite-elevated/50 px-3 py-3 space-y-2.5 ${
        isPage
          ? 'flex-1 min-h-[320px] sm:min-h-[420px]'
          : 'h-[150px] sm:h-[200px] mb-3'
      }`}
    >
      <div className="flex justify-start">
        <div className={bubble('assistant')}>
          <p className="whitespace-pre-wrap">{WELCOME}</p>
        </div>
      </div>
      {messages.map((m) => {
        const role = m.role === 'user' ? 'user' : 'assistant';
        const content = m.parts.map((part, i) => {
          if (part.type === 'text') {
            return part.text ? (
              <p key={i} className="whitespace-pre-wrap">
                {part.text}
              </p>
            ) : null;
          }
          if (part.type === 'file' && part.mediaType.startsWith('image')) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={part.url}
                alt="Uploaded"
                className="mb-2 rounded-lg max-h-28 object-cover w-full"
              />
            );
          }
          if (isToolUIPart(part)) return renderToolPart(part as ToolPart, m.id);
          return null;
        });
        if (content.every((c) => c === null)) return null;
        return (
          <div key={m.id} className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={bubble(role)}>{content}</div>
          </div>
        );
      })}
      {error && !isSending && (
        <div className="flex justify-start">
          <div className={bubble('assistant')}>
            <p>I hit a snag answering that. Please try again.</p>
          </div>
        </div>
      )}
      {(isSending || isTranscribing) && (
        <div className="flex items-center gap-2 text-xs text-ink-muted px-1">
          <Loader2 size={13} className="animate-spin text-mint" />
          {isTranscribing ? 'Transcribing…' : 'Thinking…'}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );

  const composer = (
    <div className={isPage ? 'pt-3 border-t border-graphite-border-subtle mt-3' : ''}>
      {pendingImage && (
        <div className="relative inline-block mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pendingImage.dataUrl}
            alt="Pending upload"
            className="h-14 w-14 rounded-xl object-cover border border-graphite-border"
          />
          <button
            type="button"
            onClick={() => setPendingImage(null)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-graphite-surface-2 border border-graphite-border text-ink-muted flex items-center justify-center"
          >
            <X size={11} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPickImage(e.target.files?.[0] || null)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-ink-secondary hover:text-ink hover:bg-graphite-surface-2"
          aria-label="Upload receipt"
          title="Upload receipt"
        >
          <ImagePlus size={18} aria-hidden="true" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendToAssistant({ text: input, image: pendingImage });
            }
          }}
          placeholder="Ask about balances, or log an expense / income…"
          disabled={isSending || isTranscribing || isRecording}
          className="flex-1 px-3.5 py-2.5 rounded-xl border border-graphite-border bg-[var(--surface-2)] text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-mint/30 focus:border-mint/50 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={
            isSending || isTranscribing || isRecording || (!input.trim() && !pendingImage)
          }
          onClick={() => sendToAssistant({ text: input, image: pendingImage })}
          className="p-2.5 rounded-xl bg-mint text-graphite disabled:opacity-40 hover:bg-mint-bright transition-colors"
          aria-label="Send"
        >
          {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );

  if (isPage) {
    return (
      <section className="panel shadow-panel overflow-hidden flex flex-col h-[calc(100dvh-11rem)] lg:h-[calc(100dvh-8rem)]">
        <div className="relative px-4 sm:px-5 pt-4 pb-3 border-b border-graphite-border-subtle shrink-0">
          <div className="absolute inset-0 bg-gradient-to-br from-mint/[0.06] via-transparent to-info/[0.04] pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-mint uppercase tracking-[0.16em]">
                Finance chat
              </p>
              <h2 className="text-lg font-semibold text-ink font-display mt-0.5">
                Your money, in conversation
              </h2>
              <p className="text-xs text-ink-muted mt-1">{statusLabel}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:gap-5 p-4 sm:p-5">
          {orb}
          <div className="flex flex-col min-w-0 min-h-0 h-full">
            {messageList}
            {composer}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={isEmbedded ? 'overflow-hidden' : 'panel shadow-panel overflow-hidden'}>
      {!isEmbedded && (
        <div className="relative px-4 sm:px-5 pt-4 pb-3 border-b border-graphite-border-subtle">
          <div className="absolute inset-0 bg-gradient-to-br from-mint/[0.06] via-transparent to-info/[0.04] pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium text-mint uppercase tracking-[0.16em]">
                Assistant
              </p>
              <h2 className="text-lg font-semibold text-ink font-display mt-0.5">
                What do you want to log?
              </h2>
              <p className="text-xs text-ink-muted mt-1">{statusLabel}</p>
            </div>
          </div>
        </div>
      )}
      {isEmbedded && (
        <p className="text-xs text-ink-muted px-1 pb-2">{statusLabel}</p>
      )}

      <div
        className={`grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:gap-5 ${
          isEmbedded ? 'p-1' : 'p-4 sm:p-5'
        }`}
      >
        {orb}
        <div className="flex flex-col min-w-0">
          {messageList}
          {composer}
        </div>
      </div>
    </section>
  );
}
