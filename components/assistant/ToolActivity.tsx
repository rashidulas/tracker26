'use client';

/**
 * Status chips for the assistant's read tools. While a tool runs its chip
 * shows what is being looked at ("Looking at March spending…"); once every
 * tool in the message is done they fold into one quiet line that can be
 * opened to see what was checked.
 */
import { ChevronRight, Loader2, Search } from 'lucide-react';
import type { AssistantUIMessage } from '@/lib/assistant/engine';
import { toolActivityLabel } from '@/lib/assistant/toolLabels';
import type { DayString } from '@/lib/dates';

type Part = AssistantUIMessage['parts'][number];
type ToolPart = Extract<Part, { toolCallId: string }>;

export default function ToolActivity({ parts, today }: { parts: ToolPart[]; today: DayString }) {
  if (parts.length === 0) return null;
  const items = parts.map((part) => ({
    id: part.toolCallId,
    label: toolActivityLabel(part.type.slice(5), part.input as Record<string, unknown> | undefined, today),
    running: part.state === 'input-streaming' || part.state === 'input-available',
    failed: part.state === 'output-error',
  }));
  const running = items.filter((item) => item.running);

  if (running.length > 0) {
    return (
      <ul className="mb-2 flex flex-wrap gap-1.5">
        {running.map((item) => (
          <li
            key={item.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-graphite-border-subtle bg-graphite-surface-2 px-2.5 py-1 text-xs text-ink-secondary"
          >
            <Loader2 size={12} className="animate-spin text-mint" aria-hidden="true" />
            {item.label.running}…
          </li>
        ))}
      </ul>
    );
  }

  // Calls the model corrected and repeated are not worth listing as failures.
  const done = items.filter((item) => !item.failed);
  if (done.length === 0) return null;
  const summary = done.length === 1 ? done[0].label.done : `Looked at ${done.length} things`;
  return (
    <details className="group/activity mb-2">
      <summary
        className={`inline-flex min-h-[28px] list-none items-center gap-1.5 rounded-full px-1 text-xs text-ink-muted [&::-webkit-details-marker]:hidden ${
          done.length > 1 ? 'cursor-pointer hover:text-ink-secondary' : 'pointer-events-none'
        }`}
        tabIndex={done.length > 1 ? 0 : -1}
      >
        <Search size={12} aria-hidden="true" />
        {summary}
        {done.length > 1 && (
          <ChevronRight size={12} aria-hidden="true" className="transition-transform group-open/activity:rotate-90" />
        )}
      </summary>
      {done.length > 1 && (
        <ul className="ml-1.5 mt-1 space-y-0.5 border-l border-graphite-border-subtle pl-3 text-xs text-ink-muted">
          {done.map((item) => (
            <li key={item.id}>{item.label.done}</li>
          ))}
        </ul>
      )}
    </details>
  );
}
