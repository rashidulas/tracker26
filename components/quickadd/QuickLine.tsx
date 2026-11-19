'use client';

/**
 * The one-line entry at the top of the quick-add form: type (or say)
 * "12.50 lunch chipotle discover yesterday" and the form below fills in.
 * This component is only the field, its microphone and the row of chips that
 * shows what was understood; the parsing lives in the form (ExpenseForm) and
 * lib/ai/quickAddParse.ts.
 */
import { Loader2, Mic, Sparkles, Square, X } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';
import { useVoiceRecorder } from '@/components/assistant/useVoiceRecorder';

export type QuickLineChip = { key: string; label: string };

export default function QuickLine({
  id,
  value,
  onChange,
  chips,
  thinking,
  leftover,
}: {
  id: string;
  value: string;
  /** viaVoice: the text came from the microphone. */
  onChange: (text: string, viaVoice: boolean) => void;
  /** What the text was understood as, in form order. */
  chips: QuickLineChip[];
  /** A model is being asked about the words the code could not place. */
  thinking: boolean;
  /** Words nothing explains (shown so nothing is dropped silently). */
  leftover?: string;
}) {
  const toast = useToast();
  const voice = useVoiceRecorder({
    onText: (spoken) => onChange(value.trim() ? `${value.trim()} ${spoken}` : spoken, true),
    onError: (message) => toast.error(message),
  });
  const listening = voice.state === 'requesting' || voice.state === 'recording';
  const transcribing = voice.state === 'transcribing';

  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Describe the expense in one line
      </label>
      <div className="relative">
        <Sparkles
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint"
          aria-hidden="true"
        />
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value, false)}
          onKeyDown={(e) => {
            // Enter here must not submit the form: the line only fills it in.
            if (e.key === 'Enter') e.preventDefault();
          }}
          placeholder={listening ? 'Listening…' : 'Type it: 12.50 lunch chipotle discover yesterday'}
          autoComplete="off"
          autoCapitalize="off"
          enterKeyHint="done"
          aria-describedby={`${id}-understood`}
          className="w-full rounded-xl border border-graphite-border bg-[var(--surface-2)] py-3 pl-10 pr-[5.25rem] text-base text-ink placeholder-ink-muted transition-colors focus:border-mint/50 focus:outline-none focus:ring-2 focus:ring-mint/30"
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          {value && !listening && (
            <button
              type="button"
              onClick={() => onChange('', false)}
              className="inline-flex h-10 w-9 items-center justify-center rounded-lg text-ink-muted hover:text-ink"
              aria-label="Clear the line"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => (voice.state === 'idle' ? void voice.start() : voice.stop())}
            disabled={transcribing}
            aria-pressed={listening}
            aria-label={listening ? 'Stop and use what I said' : 'Say it instead'}
            title={listening ? 'Stop' : 'Say it instead'}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
              listening ? 'bg-danger-dim text-danger' : 'text-ink-secondary hover:bg-graphite-surface-hover hover:text-ink'
            }`}
          >
            {transcribing ? (
              <Loader2 size={17} className="animate-spin" aria-hidden="true" />
            ) : listening ? (
              <Square size={15} aria-hidden="true" />
            ) : (
              <Mic size={17} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div id={`${id}-understood`} aria-live="polite" className="mt-2 flex min-h-[1.5rem] flex-wrap items-center gap-1.5">
        {listening && (
          <span className="text-xs text-ink-muted">
            Recording {voice.seconds > 0 ? `${voice.seconds}s` : ''} — tap the square when you are done
          </span>
        )}
        {!listening && chips.length === 0 && !thinking && !leftover && (
          <span className="text-xs text-ink-muted">
            Fills the form below as you type. Check it, then save.
          </span>
        )}
        {chips.map((chip) => (
          <span
            key={chip.key}
            className="inline-flex max-w-full items-center rounded-full border border-mint/25 bg-mint-dim px-2.5 py-0.5 text-xs text-mint"
          >
            <span className="truncate">{chip.label}</span>
          </span>
        ))}
        {thinking && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            working out “{leftover}”
          </span>
        )}
        {!thinking && leftover && (
          <span className="inline-flex items-center rounded-full border border-graphite-border-subtle px-2.5 py-0.5 text-xs text-ink-muted">
            not used: {leftover}
          </span>
        )}
      </div>
    </div>
  );
}
