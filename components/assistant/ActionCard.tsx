'use client';

/**
 * The approval card for every write tool other than "add one expense / one
 * income" (lib/assistant/actions.ts): edits, deletes, batches, transfers,
 * friends, goals, budgets, recurring entries, categories.
 *
 * The card draws what the server worked out by trying the change
 * (lib/assistant/preview.ts): each record, its values before and after, and
 * how many records are affected. Values the server marked as editable can be
 * changed in place; Approve sends those changes with the approval and the
 * server checks the changed version again before saving anything.
 */
import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, CircleSlash, Loader2, Minus, Pencil, Plus, TriangleAlert } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import type { AssistantUIMessage } from '@/lib/assistant/engine';
import {
  decodePreview,
  type FieldEdits,
  type PreviewField,
  type PreviewItem,
  type ProposalPreview,
} from '@/lib/assistant/preview';
import type { ChatReference } from '@/lib/assistant/starters';
import { proposalNoun } from '@/lib/assistant/toolLabels';
import type { ProposalEdit } from '@/lib/assistant/write';
import { formatDay, isValidDay } from '@/lib/dates';

type Part = AssistantUIMessage['parts'][number];
export type ActionPart = Extract<
  Part,
  {
    type:
      | 'tool-logTransactions'
      | 'tool-changeTransactions'
      | 'tool-moveMoney'
      | 'tool-updateFriends'
      | 'tool-updateGoals'
      | 'tool-updateBudgets'
      | 'tool-updateRecurring'
      | 'tool-updateCategories';
  }
>;

type Props = {
  part: ActionPart;
  reference: ChatReference;
  superseded: boolean;
  busy: boolean;
  onApprove: (edit: ProposalEdit | null) => void;
  onDismiss: () => void;
};

const shell = 'my-3 rounded-2xl border bg-graphite-elevated/80 p-3.5 sm:p-4';
// 16px on phones (the shared fields are 14px there, which makes iOS zoom).
const control = '!text-base !py-2';
const eyebrow = 'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]';

const TONE = {
  add: { icon: Plus, className: 'text-mint', label: 'Added' },
  change: { icon: Pencil, className: 'text-warning', label: 'Changed' },
  remove: { icon: Minus, className: 'text-danger', label: 'Removed' },
} as const;

/** Days arrive as YYYY-MM-DD; show them the way the rest of the app does. */
const shown = (value: string) =>
  isValidDay(value) ? formatDay(value, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : value;

function FieldRows({ fields }: { fields: PreviewField[] }) {
  if (fields.length === 0) return null;
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {fields.map((field, index) => (
        <div key={`${field.label}-${index}`} className="contents">
          <dt className="text-ink-muted">
            {isValidDay(field.label) ? formatDay(field.label, { month: 'short', day: 'numeric' }) : field.label}
          </dt>
          <dd className="min-w-0 break-words text-ink">
            {field.was !== undefined && (
              <>
                <s className="text-ink-muted">{shown(field.was)}</s>
                <span className="sr-only"> changes to </span>
                <span aria-hidden="true" className="text-ink-muted"> → </span>
              </>
            )}
            {shown(field.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ItemHeading({ item }: { item: PreviewItem }) {
  const tone = TONE[item.tone];
  const Icon = tone.icon;
  return (
    <p className="flex items-start gap-2 text-sm font-medium text-ink">
      <Icon size={14} strokeWidth={2.4} className={`mt-[3px] shrink-0 ${tone.className}`} aria-hidden="true" />
      <span className="sr-only">{tone.label}: </span>
      <span className="min-w-0 break-words">{item.title}</span>
    </p>
  );
}

/** The records of a proposal, read-only. */
function Items({ preview }: { preview: ProposalPreview }) {
  return (
    <ul className="mt-2.5 space-y-2.5">
      {preview.items.map((item, index) => (
        <li key={index} className="min-w-0">
          <ItemHeading item={item} />
          <div className="pl-[22px]">
            <FieldRows fields={item.fields.filter((f) => f.value)} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ActionCard({ part, reference, superseded, busy, onApprove, onDismiss }: Props) {
  const noun = proposalNoun(part.type.slice(5), part.input as Record<string, unknown> | undefined);

  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return (
        <p className="my-2 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Preparing {noun}…
        </p>
      );

    case 'approval-requested': {
      // Automatic approvals are proposals the server is still checking.
      if (part.approval.isAutomatic) return null;
      const preview = decodePreview(part.approval.requestReason);
      if (!preview) return null;
      if (superseded) {
        return (
          <div className={`${shell} border-graphite-border-subtle`}>
            <p className={`${eyebrow} text-ink-muted`}>
              <CircleSlash size={13} aria-hidden="true" /> Not saved
            </p>
            <p className="mt-1.5 text-sm text-ink-muted">{preview.heading}. Nothing was changed.</p>
          </div>
        );
      }
      return (
        <EditableAction
          preview={preview}
          reference={reference}
          busy={busy}
          onApprove={onApprove}
          onDismiss={onDismiss}
        />
      );
    }

    case 'approval-responded':
      return (
        <div className={`${shell} border-graphite-border-subtle`}>
          <p className="flex items-center gap-2 text-sm text-ink-secondary">
            {part.approval.approved ? (
              <>
                <Loader2 size={14} className="animate-spin text-mint" aria-hidden="true" /> Saving…
              </>
            ) : (
              <>
                <CircleSlash size={14} aria-hidden="true" /> Dismissed
              </>
            )}
          </p>
        </div>
      );

    case 'output-available': {
      const { preview, editedByUser, alreadySaved } = part.output;
      return (
        <div className={`${shell} border-mint/25`}>
          <p className={`${eyebrow} text-mint`}>
            <Check size={14} strokeWidth={2.6} aria-hidden="true" /> Approved
            <span className="font-medium normal-case tracking-normal text-ink-secondary">· {preview.done}</span>
            {editedByUser && <span className="font-medium normal-case tracking-normal text-ink-muted">· with your changes</span>}
            {alreadySaved && <span className="font-medium normal-case tracking-normal text-ink-muted">· already saved</span>}
          </p>
          <Items preview={preview} />
          {preview.link && (
            <Link
              href={preview.link.href}
              className="mt-2.5 inline-flex min-h-[36px] items-center gap-1 text-sm text-mint hover:text-mint-bright"
            >
              {preview.link.label} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
      );
    }

    case 'output-denied': {
      // The server sent the proposal back to the model to fix; the user never saw it.
      if (part.approval.isAutomatic) return null;
      const preview = decodePreview(part.approval.requestReason);
      return (
        <div className={`${shell} border-graphite-border-subtle`}>
          <p className={`${eyebrow} text-ink-muted`}>
            <CircleSlash size={13} aria-hidden="true" />
            {part.approval.approved ? 'Not saved' : 'Dismissed'}
          </p>
          <p className="mt-1.5 text-sm text-ink-muted">
            {preview ? `${preview.heading}. ` : ''}
            {part.approval.approved ? 'That version could not be saved. Nothing was changed.' : 'Nothing was changed.'}
          </p>
        </div>
      );
    }

    case 'output-error':
      return (
        <div className={`${shell} border-danger/25`} role="alert">
          <p className={`${eyebrow} text-danger`}>
            <TriangleAlert size={13} aria-hidden="true" /> Not saved
          </p>
          <p className="mt-1.5 text-sm text-ink-secondary">This {noun} could not be saved. Nothing was changed.</p>
        </div>
      );

    default:
      return null;
  }
}

const asText = (value: string | number | null, isAmount: boolean) =>
  value === null ? '' : isAmount && typeof value === 'number' ? value.toFixed(2) : String(value);

function EditableAction({
  preview,
  reference,
  busy,
  onApprove,
  onDismiss,
}: {
  preview: ProposalPreview;
  reference: ChatReference;
  busy: boolean;
  onApprove: (edit: ProposalEdit | null) => void;
  onDismiss: () => void;
}) {
  const formId = useId();
  const editable = useMemo(
    () => preview.items.flatMap((item) => item.fields).filter((f) => f.edit),
    [preview]
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((f) => [f.edit!.key, asText(f.edit!.value, f.edit!.control === 'amount')]))
  );
  const [submitted, setSubmitted] = useState(false);

  const options = useMemo(() => {
    const categories = (type: 'INCOME' | 'EXPENSE') =>
      reference.categories.filter((c) => c.type === type).map((c) => ({ value: c.id, label: c.name }));
    return {
      account: reference.accounts.map((a) => ({ value: a.id, label: a.name })),
      expenseCategory: categories('EXPENSE'),
      incomeCategory: categories('INCOME'),
    };
  }, [reference]);

  // What changed, and what is wrong, per field key.
  const errors: Record<string, string> = {};
  const fields: FieldEdits = {};
  for (const field of editable) {
    const { key, control: kind, value: original } = field.edit!;
    const text = (values[key] ?? '').trim();
    if (kind === 'amount') {
      const amount = Number(text.replace(/[$,\s]/g, ''));
      if (text === '' || !Number.isFinite(amount) || amount < 0) errors[key] = 'Enter an amount';
      else if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) errors[key] = 'Use at most 2 decimals';
      else if (amount !== original) fields[key] = amount;
    } else if (kind === 'date') {
      if (text === '' && original === null) continue;
      if (!isValidDay(text)) errors[key] = 'Pick a date';
      else if (text !== original) fields[key] = text;
    } else if (kind === 'month') {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) errors[key] = 'Pick a month';
      else if (text !== original) fields[key] = text;
    } else if (kind === 'text') {
      const clean = text.replace(/\s+/g, ' ');
      if (clean !== String(original ?? '').replace(/\s+/g, ' ').trim()) fields[key] = clean || null;
    } else if (text !== (original ?? '')) {
      fields[key] = text || null;
    }
  }
  const changed = Object.keys(fields).length > 0;
  const hasErrors = Object.keys(errors).length > 0;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors) return;
    onApprove(changed ? { fields } : null);
  };

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const renderControl = (field: PreviewField) => {
    const { key, control: kind, value: original } = field.edit!;
    const value = values[key] ?? '';
    const error = submitted ? errors[key] : undefined;
    if (kind === 'account' || kind === 'expenseCategory' || kind === 'incomeCategory') {
      let list = options[kind];
      // A value that may be left empty, or that is no longer in the list, still has to be shown.
      if (original === null) list = [{ value: '', label: kind === 'account' ? 'No account' : 'Choose…' }, ...list];
      else if (!list.some((o) => o.value === value)) list = [{ value, label: field.value || 'Choose…' }, ...list];
      return (
        <Select
          key={key}
          label={field.label}
          value={value}
          onChange={(e) => set(key, e.target.value)}
          options={list}
          className={control}
        />
      );
    }
    return (
      <div key={key} className={kind === 'text' ? 'col-span-2' : undefined}>
        <Input
          label={field.label}
          type={kind === 'date' ? 'date' : kind === 'month' ? 'month' : 'text'}
          inputMode={kind === 'amount' ? 'decimal' : undefined}
          autoComplete="off"
          maxLength={kind === 'text' ? 100 : undefined}
          value={value}
          onChange={(e) => set(key, e.target.value)}
          error={error}
          className={`${control} ${kind === 'amount' ? 'money' : ''}`}
        />
      </div>
    );
  };

  const accent = preview.destructive ? 'border-danger/35' : 'border-graphite-border';
  return (
    <form onSubmit={save} aria-labelledby={`${formId}-title`} className={`${shell} ${accent}`}>
      <p id={`${formId}-title`} className={`${eyebrow} ${preview.destructive ? 'text-danger' : 'text-warning'}`}>
        {preview.destructive && <TriangleAlert size={13} aria-hidden="true" />}
        {preview.heading}
        <span className="font-medium normal-case tracking-normal text-ink-muted">· to approve</span>
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">
        {preview.destructive
          ? `Affects ${preview.count} ${preview.count === 1 ? 'record' : 'records'}. Check the list before you approve.`
          : editable.length > 0
            ? 'Check it, change anything that is off, then approve.'
            : 'Nothing changes until you approve.'}
      </p>

      <ul className="mt-3 space-y-3">
        {preview.items.map((item, index) => {
          const inputs = item.fields.filter((f) => f.edit);
          const rows = item.fields.filter((f) => !f.edit && f.value);
          // An edited record keeps its "before" values in view above the inputs.
          const before = inputs.filter((f) => f.was !== undefined).map(({ label, value, was }) => ({ label, value, was }));
          return (
            <li key={index} className="min-w-0">
              <ItemHeading item={item} />
              <div className="pl-[22px]">
                <FieldRows fields={[...before, ...rows]} />
                {inputs.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">{inputs.map(renderControl)}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {preview.warning && (
        <p
          className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
            preview.destructive
              ? 'border-danger/25 bg-danger-dim text-danger'
              : 'border-graphite-border-subtle bg-graphite-surface-2 text-ink-secondary'
          }`}
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{preview.warning}</span>
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          variant={preview.destructive ? 'danger' : 'primary'}
          className="min-h-[44px] flex-1"
          disabled={busy}
        >
          {!preview.destructive && <Check size={15} aria-hidden="true" />}
          {/* "Yes, delete", "Yes, move": short enough for a phone, and says what it does. */}
          {preview.destructive
            ? `Yes, ${preview.heading.split(' ')[0].toLowerCase()}`
            : changed
              ? 'Approve changes'
              : 'Approve'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-[44px] flex-1"
          disabled={busy}
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
    </form>
  );
}
