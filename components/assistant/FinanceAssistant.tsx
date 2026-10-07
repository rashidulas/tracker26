'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Send, X } from 'lucide-react';
import Button from '@/components/Button';
import { confirmAssistantDraft } from '@/app/dashboard/assistantActions';
import type { AssistantDraft } from '@/lib/assistant';
import { useToast } from '@/components/ToastProvider';

type UiDraft = AssistantDraft & {
  categoryName?: string;
  accountName?: string | null;
};

type UiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imagePreview?: string;
  draft?: UiDraft | null;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export default function FinanceAssistant() {
  const { success, error: toastError } = useToast();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hold the orb and say something like “I spent $42 on groceries,” or type below. Nothing saves until you confirm.',
    },
  ]);
  const [pendingImage, setPendingImage] = useState<{
    dataUrl: string;
    mimeType: string;
  } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const holdStartedRef = useRef(false);
  const pendingImageRef = useRef(pendingImage);
  const sendRef = useRef<(payload: { text: string; image?: { dataUrl: string; mimeType: string } | null }) => Promise<void>>(
    async () => {}
  );

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
      if (!text && !payload.image) return;

      const userMessage: UiMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text || 'Please review this image.',
        imagePreview: payload.image?.dataUrl,
      };

      let nextMessages: UiMessage[] = [];
      setMessages((prev) => {
        nextMessages = [...prev, userMessage];
        return nextMessages;
      });
      setInput('');
      setPendingImage(null);
      setIsSending(true);

      try {
        const history = nextMessages
          .filter((m) => m.id !== 'welcome')
          .map((m) => ({
            role: m.role,
            content: m.content,
          }));

        const apiMessages = history.map((m, i) => {
          if (i === history.length - 1 && payload.image) {
            return {
              role: m.role,
              content: m.content,
              image: payload.image,
            };
          }
          return { role: m.role, content: m.content };
        });

        const res = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages }),
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Assistant failed');
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: data.data.message,
            draft: data.data.draft,
          },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Something went wrong';
        toastError(msg);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-err-${Date.now()}`,
            role: 'assistant',
            content: `I hit a snag: ${msg}`,
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [toastError]
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
          // Hold-to-talk: auto-send after speech, Siri-style
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

  const handleConfirm = async (messageId: string, draft: UiDraft) => {
    setConfirmingId(messageId);
    try {
      const { categoryName: _c, accountName: _a, ...clean } = draft;
      const result = await confirmAssistantDraft(clean);
      if (!result.success) {
        throw new Error(result.error || 'Failed to save');
      }
      success(draft.kind === 'INCOME' ? 'Income added' : 'Expense added');
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                draft: null,
                content: `${m.content}\n\nSaved ${draft.kind === 'INCOME' ? 'income' : 'expense'} of ${formatMoney(draft.amount)}.`,
              }
            : m
        )
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setConfirmingId(null);
    }
  };

  const handleDiscard = (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, draft: null } : m))
    );
  };

  const statusLabel = isRecording
    ? 'Listening… release to send'
    : isTranscribing
      ? 'Transcribing…'
      : isSending
        ? 'Thinking…'
        : 'Hold to talk';

  return (
    <section className="panel shadow-panel overflow-hidden">
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

      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 sm:gap-5 p-4 sm:p-5">
        {/* Siri-style orb */}
        <div className="flex flex-col items-center justify-center gap-2 sm:min-w-[140px] py-1">
          <button
            type="button"
            onPointerDown={onOrbPointerDown}
            onPointerUp={onOrbPointerUp}
            onPointerCancel={onOrbPointerUp}
            onPointerLeave={(e) => {
              if (holdStartedRef.current) onOrbPointerUp(e);
            }}
            disabled={isSending || isTranscribing}
            className={`siri-orb siri-orb--mobile touch-none select-none ${
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

        {/* Chat column */}
        <div className="flex flex-col min-w-0">
          <div className="h-[150px] sm:h-[200px] overflow-y-auto rounded-xl border border-graphite-border-subtle bg-graphite-elevated/50 px-3 py-3 space-y-2.5 mb-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-mint-dim text-ink border border-mint/20'
                      : 'bg-graphite-surface-2 text-ink-secondary border border-graphite-border-subtle'
                  }`}
                >
                  {m.imagePreview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.imagePreview}
                      alt="Uploaded"
                      className="mb-2 rounded-lg max-h-28 object-cover w-full"
                    />
                  )}
                  <p className="whitespace-pre-wrap">{m.content}</p>

                  {m.draft && (
                    <div className="mt-2.5 rounded-xl border border-graphite-border bg-graphite-elevated/90 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                            m.draft.kind === 'INCOME' ? 'text-mint' : 'text-danger'
                          }`}
                        >
                          {m.draft.kind} draft
                        </span>
                        {m.draft.confidence && (
                          <span className="text-[10px] text-ink-muted capitalize">
                            {m.draft.confidence}
                          </span>
                        )}
                      </div>
                      <p className="text-lg font-semibold text-ink money">
                        {formatMoney(m.draft.amount)}
                      </p>
                      <p className="text-[11px] text-ink-muted">
                        {m.draft.categoryName || 'Category'} · {m.draft.date}
                        {m.draft.accountName || m.draft.merchantOrSource
                          ? ` · ${[m.draft.accountName, m.draft.merchantOrSource]
                              .filter(Boolean)
                              .join(' · ')}`
                          : ''}
                      </p>
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={confirmingId === m.id}
                          onClick={() => handleConfirm(m.id, m.draft!)}
                        >
                          {confirmingId === m.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="flex-1"
                          onClick={() => handleDiscard(m.id)}
                          disabled={confirmingId === m.id}
                        >
                          Discard
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {(isSending || isTranscribing) && (
              <div className="flex items-center gap-2 text-xs text-ink-muted px-1">
                <Loader2 size={13} className="animate-spin text-mint" />
                {isTranscribing ? 'Transcribing…' : 'Thinking…'}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

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
              className="p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-graphite-surface-2"
              aria-label="Upload receipt"
              title="Upload receipt"
            >
              <ImagePlus size={18} />
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
              placeholder="Or type an expense / income…"
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
      </div>
    </section>
  );
}
