'use client';

/**
 * The card for an expense or income the assistant proposes.
 *
 * While it waits for a decision every field can be changed in place. Save
 * sends the approval together with whatever was changed; the server applies
 * the changes to the proposal it signed and checks the result again before
 * saving (lib/assistant/write.ts). Afterwards the card shows what happened:
 * Approved (with what was saved), Dismissed, or why it was not saved.
 */
import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, CircleSlash, Loader2, TriangleAlert } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import type { AssistantUIMessage } from '@/lib/assistant/engine';
import type { ChatReference } from '@/lib/assistant/starters';
import type { ProposalEdit } from '@/lib/assistant/write';
import { formatDay, isValidDay } from '@/lib/dates';
import { formatCurrency } from '@/lib/utils';

type Part = AssistantUIMessage['parts'][number];
export type WritePart = Extract<Part, { type: 'tool-createExpense' | 'tool-createIncome' }>;

export const isWritePart = (part: Part): part is WritePart =>
  part.type === 'tool-createExpense' || part.type === 'tool-createIncome';

type Props = {
  part: WritePart;
  reference: ChatReference;
  /** A newer message was sent instead of answering this card. */
  superseded: boolean;
  /** A reply is in progress; decisions wait until it is done. */
  busy: boolean;
  onApprove: (edit: ProposalEdit | null) => void;
  onDismiss: () => void;
};

const shell = 'my-3 rounded-2xl border bg-graphite-elevated/80 p-3.5 sm:p-4';
// 16px on phones (the shared fields are 14px there, which makes iOS zoom).
const field = '!text-base !py-2';

function Heading({ kind, tone, children }: { kind: string; tone: string; children: React.ReactNode }) {
  return (
    <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${tone}`}>
      {children}
      <span className="sr-only">{kind}</span>
    </p>
  );
}

function Details({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="min-w-0 truncate text-ink">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** "$18.00 at Uber. " for a proposal that was not saved, from whatever of it is known. */
function proposedLine(input: Partial<WritePart['input']> | undefined, isIncome: boolean) {
  if (typeof input?.amount !== 'number') return '';
  const merchant = input.merchant?.trim();
  return `${formatCurrency(input.amount)}${merchant ? ` ${isIncome ? 'from' : 'at'} ${merchant}` : ''}. `;
}

const longDay = (day: string) =>
  isValidDay(day) ? formatDay(day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : day;

export default function ProposalCard({ part, reference, superseded, busy, onApprove, onDismiss }: Props) {
  const isIncome = part.type === 'tool-createIncome';
  const kind = isIncome ? 'Income' : 'Expense';

  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
      return (
        <p className="my-2 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Preparing {kind.toLowerCase()}…
        </p>
      );

    case 'approval-requested':
      // Automatic approvals are proposals the server is still checking.
      if (part.approval.isAutomatic) return null;
      if (superseded) {
        return (
          <div className={`${shell} border-graphite-border-subtle`}>
            <Heading kind={kind} tone="text-ink-muted">
              <CircleSlash size={13} aria-hidden="true" /> Not saved
            </Heading>
            <p className="mt-1.5 text-sm text-ink-muted">{part.approval.requestReason}</p>
          </div>
        );
      }
      return (
        <EditableProposal
          part={part}
          kind={kind}
          isIncome={isIncome}
          reference={reference}
          busy={busy}
          onApprove={onApprove}
          onDismiss={onDismiss}
        />
      );

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
      const { details, transactionId, editedByUser, alreadySaved } = part.output;
      const list = isIncome ? 'income' : 'expenses';
      return (
        <div className={`${shell} border-mint/25`}>
          <div className="flex items-start justify-between gap-3">
            <Heading kind={kind} tone="text-mint">
              <Check size={14} strokeWidth={2.6} aria-hidden="true" /> Approved
              {editedByUser && <span className="font-medium normal-case tracking-normal text-ink-muted">· with your changes</span>}
              {alreadySaved && <span className="font-medium normal-case tracking-normal text-ink-muted">· already saved</span>}
            </Heading>
            <p className={`money text-base font-semibold ${isIncome ? 'text-mint' : 'text-ink'}`}>
              {formatCurrency(details.amount)}
            </p>
          </div>
          <Details
            rows={[
              [isIncome ? 'From' : 'Merchant', details.merchant],
              ['Category', details.subcategory ? `${details.category} › ${details.subcategory}` : details.category],
              [isIncome ? 'Into' : 'Paid from', details.account],
              ['Date', longDay(details.date)],
            ]}
          />
          <Link
            href={`/transactions/${list}?from=${details.date}&to=${details.date}`}
            data-transaction-id={transactionId}
            className="mt-2.5 inline-flex min-h-[36px] items-center gap-1 text-sm text-mint hover:text-mint-bright"
          >
            View in {kind === 'Income' ? 'Income' : 'Expenses'} <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      );
    }

    case 'output-denied':
      // The server sent the proposal back to the model to fix; the user never saw it.
      if (part.approval.isAutomatic) return null;
      return (
        <div className={`${shell} border-graphite-border-subtle`}>
          <Heading kind={kind} tone="text-ink-muted">
            <CircleSlash size={13} aria-hidden="true" />
            {part.approval.approved ? 'Not saved' : 'Dismissed'}
          </Heading>
          <p className="mt-1.5 text-sm text-ink-muted">
            {proposedLine(part.input, isIncome)}
            {part.approval.approved
              ? 'That version could not be saved. Nothing was recorded.'
              : 'Nothing was recorded.'}
          </p>
        </div>
      );

    case 'output-error':
      return (
        <div className={`${shell} border-danger/25`} role="alert">
          <Heading kind={kind} tone="text-danger">
            <TriangleAlert size={13} aria-hidden="true" /> Not saved
          </Heading>
          <p className="mt-1.5 text-sm text-ink-secondary">
            This {kind.toLowerCase()} could not be saved. Nothing was recorded.
          </p>
        </div>
      );

    default:
      return null;
  }
}

function EditableProposal({
  part,
  kind,
  isIncome,
  reference,
  busy,
  onApprove,
  onDismiss,
}: {
  part: Extract<WritePart, { state: 'approval-requested' }>;
  kind: string;
  isIncome: boolean;
  reference: ChatReference;
  busy: boolean;
  onApprove: (edit: ProposalEdit | null) => void;
  onDismiss: () => void;
}) {
  const proposed = part.input;
  const formId = useId();
  const [amount, setAmount] = useState(() => proposed.amount.toFixed(2));
  const [date, setDate] = useState(proposed.date);
  const [categoryId, setCategoryId] = useState(proposed.categoryId);
  const [accountId, setAccountId] = useState(proposed.accountId);
  const [merchant, setMerchant] = useState(proposed.merchant ?? '');
  const [submitted, setSubmitted] = useState(false);

  const categories = useMemo(
    () =>
      reference.categories
        .filter((c) => c.type === (isIncome ? 'INCOME' : 'EXPENSE'))
        .map((c) => ({ value: c.id, label: c.name })),
    [reference.categories, isIncome]
  );
  const accounts = useMemo(
    () => reference.accounts.map((a) => ({ value: a.id, label: a.name })),
    [reference.accounts]
  );
  // A choice that is no longer in the list still has to be shown as chosen.
  const withCurrent = (options: { value: string; label: string }[], value: string) =>
    options.some((o) => o.value === value) ? options : [{ value, label: 'Choose…' }, ...options];

  const parsedAmount = Number(amount.replace(/[$,\s]/g, ''));
  const amountError =
    amount.trim() === '' || !Number.isFinite(parsedAmount) || parsedAmount <= 0
      ? 'Enter an amount above 0'
      : Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) > 1e-6
        ? 'Use at most 2 decimals'
        : undefined;
  const dateError = isValidDay(date) ? undefined : 'Pick a date';

  const edit: ProposalEdit = {};
  if (!amountError && parsedAmount !== proposed.amount) edit.amount = parsedAmount;
  if (!dateError && date !== proposed.date) edit.date = date;
  if (categoryId !== proposed.categoryId) edit.categoryId = categoryId;
  if (accountId !== proposed.accountId) edit.accountId = accountId;
  const cleanMerchant = merchant.replace(/\s+/g, ' ').trim();
  if (cleanMerchant !== (proposed.merchant ?? '').replace(/\s+/g, ' ').trim()) {
    edit.merchant = cleanMerchant || null;
  }
  const changed = Object.keys(edit).length > 0;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (amountError || dateError) return;
    onApprove(changed ? edit : null);
  };

  return (
    <form
      onSubmit={save}
      aria-labelledby={`${formId}-title`}
      className={`${shell} ${isIncome ? 'border-mint/30' : 'border-graphite-border'}`}
    >
      <p
        id={`${formId}-title`}
        className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${isIncome ? 'text-mint' : 'text-warning'}`}
      >
        {kind} to approve
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">Check it, change anything that is off, then save.</p>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Input
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={submitted ? amountError : undefined}
          className={`${field} money`}
        />
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          error={submitted ? dateError : undefined}
          className={field}
        />
        <Select
          label="Category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          options={withCurrent(categories, categoryId)}
          className={field}
        />
        <Select
          label={isIncome ? 'Into' : 'Paid from'}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={withCurrent(accounts, accountId)}
          className={field}
        />
        <div className="col-span-2">
          <Input
            label={isIncome ? 'From' : 'Merchant'}
            value={merchant}
            maxLength={100}
            autoComplete="off"
            placeholder="Optional"
            onChange={(e) => setMerchant(e.target.value)}
            className={field}
          />
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-2">
        <Button type="submit" size="sm" className="min-h-[44px] flex-1" disabled={busy}>
          <Check size={15} aria-hidden="true" /> {changed ? 'Save with changes' : 'Save'}
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
