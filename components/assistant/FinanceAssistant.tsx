'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ImagePlus,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
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
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi — tap the mic and say something like “I spent $42 on groceries today,” or upload a receipt. I’ll draft it for you to confirm.',
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

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, isSending]);

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

  const sendToAssistant = async (payload: {
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

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setPendingImage(null);
    setIsSending(true);

    try {
      const history = nextMessages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.role === 'user' && m.imagePreview
            ? {
                image: {
                  dataUrl: m.imagePreview,
                  mimeType: payload.image?.mimeType || 'image/jpeg',
                },
              }
            : {}),
        }));

      // Only attach image on the latest user turn to keep payload smaller
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
  };

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
          formData.append('audio', blob, `speech.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
          const res = await fetch('/api/assistant/transcribe', {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Transcription failed');
          }
          setInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
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
    }
  };

  const toggleMic = () => {
    if (isRecording) stopRecording();
    else void startRecording();
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-mint text-graphite font-semibold pl-4 pr-5 py-3.5 shadow-glow transition-all duration-200 hover:bg-mint-bright active:scale-[0.98] ${
          open ? 'opacity-0 pointer-events-none scale-90' : 'opacity-100'
        }`}
        aria-label="Open finance assistant"
      >
        <Sparkles size={18} />
        <span className="text-sm">Ask</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={() => {
              stopRecording();
              setOpen(false);
            }}
          />

          <div className="relative w-full sm:max-w-md h-[min(88vh,680px)] sm:h-[680px] bg-graphite-surface border border-graphite-border sm:rounded-2xl rounded-t-2xl shadow-panel flex flex-col animate-fade-up overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-graphite-border-subtle">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-mint-dim border border-mint/20 flex items-center justify-center">
                  <Sparkles size={16} className="text-mint" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-ink font-display">Assistant</h2>
                  <p className="text-[11px] text-ink-muted">Voice · text · receipts</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopRecording();
                  setOpen(false);
                }}
                className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-graphite-surface-2"
                aria-label="Close assistant"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
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
                        className="mb-2 rounded-xl max-h-36 object-cover w-full"
                      />
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>

                    {m.draft && (
                      <div className="mt-3 rounded-xl border border-graphite-border bg-graphite-elevated/80 p-3 space-y-2">
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
                              {m.draft.confidence} confidence
                            </span>
                          )}
                        </div>
                        <p className="text-xl font-semibold text-ink money">
                          {formatMoney(m.draft.amount)}
                        </p>
                        <div className="text-xs text-ink-muted space-y-1">
                          <p>
                            {m.draft.categoryName || 'Category'} · {m.draft.date}
                          </p>
                          {(m.draft.accountName || m.draft.merchantOrSource) && (
                            <p>
                              {[m.draft.accountName, m.draft.merchantOrSource]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
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
                  <Loader2 size={14} className="animate-spin text-mint" />
                  {isTranscribing ? 'Transcribing…' : 'Thinking…'}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-graphite-border-subtle p-3 space-y-2">
              {pendingImage && (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pendingImage.dataUrl}
                    alt="Pending upload"
                    className="h-16 w-16 rounded-xl object-cover border border-graphite-border"
                  />
                  <button
                    type="button"
                    onClick={() => setPendingImage(null)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-graphite-surface-2 border border-graphite-border text-ink-muted flex items-center justify-center"
                  >
                    <X size={12} />
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
                  className="p-2.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-graphite-surface-2 border border-transparent"
                  aria-label="Upload receipt"
                  title="Upload receipt"
                >
                  <ImagePlus size={18} />
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="hidden"
                  aria-hidden
                >
                  <Camera size={18} />
                </button>

                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={isTranscribing || isSending}
                  className={`p-2.5 rounded-xl border transition-colors ${
                    isRecording
                      ? 'bg-danger-dim text-danger border-danger/30 animate-pulse'
                      : 'text-ink-secondary hover:text-ink hover:bg-graphite-surface-2 border-transparent'
                  }`}
                  aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
                >
                  {isRecording ? <Square size={18} /> : <Mic size={18} />}
                </button>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendToAssistant({ text: input, image: pendingImage });
                    }
                  }}
                  rows={1}
                  placeholder={
                    isRecording ? 'Listening… tap stop when done' : 'Say or type an expense…'
                  }
                  className="flex-1 resize-none max-h-28 px-3.5 py-2.5 rounded-xl border border-graphite-border bg-[var(--surface-2)] text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-mint/30 focus:border-mint/50"
                />

                <button
                  type="button"
                  disabled={isSending || isTranscribing || (!input.trim() && !pendingImage)}
                  onClick={() => sendToAssistant({ text: input, image: pendingImage })}
                  className="p-2.5 rounded-xl bg-mint text-graphite disabled:opacity-40 hover:bg-mint-bright transition-colors"
                  aria-label="Send"
                >
                  {isSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
              <p className="text-[10px] text-ink-muted text-center">
                Nothing is saved until you tap Confirm
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
