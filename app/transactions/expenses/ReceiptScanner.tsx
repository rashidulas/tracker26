'use client';

/**
 * Scan a receipt and review the draft before it is saved.
 *
 * The image goes to app/api/scan-receipt, which runs the shared receipt
 * pipeline (lib/ai/receipts.ts) and returns a draft that was already checked
 * in code. This screen only shows it: a field the pipeline could not read is
 * left empty for the user (never guessed), and line items that belong to
 * different categories arrive as a split the user can adjust or undo.
 * Saving goes through the same createExpense action as the expense form,
 * marked as coming from a receipt so it lands in the review inbox.
 */
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { todayInAppTimeZone } from '@/lib/dates';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import Select from '@/components/Select';
import Button from '@/components/Button';
import { prepareImage } from '@/components/assistant/Composer';
import { DuplicateWarning, useDuplicateGuard } from '@/components/transactions/DuplicateWarning';
import { notifyReviewChanged } from '@/components/review/reviewCount';
import { loadExpensePrefs } from '@/lib/expensePrefs';
import type { ReceiptDraft } from '@/lib/ai/receipts';
import { formatCurrency } from '@/lib/utils';
import { createExpense } from './actions';
import { Camera, Upload, Loader2, CheckCircle2, AlertCircle, ImageIcon, Sparkles, RotateCcw, Info } from 'lucide-react';

const reviewSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z
    .string()
    .min(1, 'Amount is required')
    .refine((v) => Number(v) > 0, 'Amount must be greater than 0'),
  categoryId: z.string().optional(),
  accountId: z.string().min(1, 'Account is required'),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
});

type ReviewFormData = z.infer<typeof reviewSchema>;

interface ReceiptScannerProps {
  categories: Array<{ id: string; name: string; icon?: string | null }>;
  accounts: Array<{ id: string; name: string }>;
  onSuccess: () => void;
  onCancel: () => void;
}

type ScanStep = 'upload' | 'scanning' | 'review' | 'error';
type SplitRow = { categoryId: string; amount: string; notes: string | null };

const toCents = (raw: string | number) => Math.round(Number(raw) * 100);

export default function ReceiptScanner({ categories, accounts, onSuccess, onCancel }: ReceiptScannerProps) {
  const [step, setStep] = useState<ScanStep>('upload');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [splits, setSplits] = useState<SplitRow[] | null>(null);
  const [scanError, setScanError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const duplicateGuard = useDuplicateGuard();
  // A scan that is abandoned ("Scan another") must not fill the form later.
  const scanRef = useRef(0);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<ReviewFormData>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      date: todayInAppTimeZone(),
      amount: '',
      categoryId: '',
      accountId: '',
      merchantOrSource: '',
      notes: '',
      tags: '',
    },
  });
  const amountVal = watch('amount');

  const regularCategories = categories.filter((c) => c.name !== 'Payment' && c.name !== 'Debt Payment');
  const categoryOptions = regularCategories.map((c) => ({
    value: c.id,
    label: `${c.icon ? `${c.icon} ` : ''}${c.name}`,
  }));

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setScanError('Please select an image file');
      setStep('error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setScanError('Image must be smaller than 10MB');
      setStep('error');
      return;
    }
    const scan = (scanRef.current += 1);
    setStep('scanning');
    setScanError('');
    try {
      // Downscaled in the browser: quicker to upload and to read.
      const image = await prepareImage(file);
      if (scan !== scanRef.current) return;
      setImagePreview(image.url);

      const response = await fetch('/api/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: image.url, mimeType: image.mediaType }),
      });
      const result = await response.json().catch(() => ({}));
      if (scan !== scanRef.current) return;
      if (!response.ok || !result.success) throw new Error(result.error || 'The receipt could not be read');

      const data = result.data as ReceiptDraft;
      const known = (id: string | null) => (id && regularCategories.some((c) => c.id === id) ? id : '');
      const lastAccount = loadExpensePrefs().lastAccountId;
      const accountId = [data.accountId, lastAccount].find((id) => id && accounts.some((a) => a.id === id)) ?? '';
      const validSplits =
        data.splits && data.splits.every((s) => known(s.categoryId)) && data.splits.length > 1 ? data.splits : null;

      setDraft(data);
      setSplits(validSplits ? validSplits.map((s) => ({ categoryId: s.categoryId, amount: s.amount.toFixed(2), notes: s.notes })) : null);
      reset({
        date: data.date ?? todayInAppTimeZone(),
        amount: data.amount !== null ? data.amount.toFixed(2) : '',
        // Empty when nothing clearly fits: the user picks, nothing is guessed.
        categoryId: known(data.categoryId),
        accountId,
        merchantOrSource: data.merchant ?? '',
        notes: '',
        tags: '',
      });
      duplicateGuard.reset();
      setStep('review');
    } catch (error) {
      if (scan !== scanRef.current) return;
      setScanError(error instanceof Error ? error.message : 'The receipt could not be read');
      setStep('error');
    }
  };

  const handleRetry = () => {
    scanRef.current += 1;
    setStep('upload');
    setImagePreview(null);
    setDraft(null);
    setSplits(null);
    setScanError('');
    setSubmitError('');
    duplicateGuard.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const splitTotalCents = (splits ?? []).reduce((sum, s) => sum + (toCents(s.amount) || 0), 0);
  const splitMismatch = splits !== null && splitTotalCents !== toCents(amountVal || 0);

  const stopSplitting = () => {
    if (!splits) return;
    // Back to one category: the largest part's, which the user can change.
    const largest = [...splits].sort((a, b) => toCents(b.amount) - toCents(a.amount))[0];
    reset({ ...watch(), categoryId: largest?.categoryId ?? '' });
    setSplits(null);
  };

  const onSubmit = async (data: ReviewFormData) => {
    setSubmitError('');
    if (!splits && !data.categoryId) {
      setError('categoryId', { message: 'Pick a category' });
      return;
    }
    if (splits && (splitMismatch || splits.some((s) => !s.categoryId || !(Number(s.amount) > 0)))) {
      setSubmitError('The parts must each have a category and add up to the total.');
      return;
    }
    setIsSubmitting(true);
    try {
      const clear = await duplicateGuard.check({
        kind: 'EXPENSE',
        accountId: data.accountId,
        amount: Number(data.amount),
        date: data.date,
        merchant: data.merchantOrSource,
      });
      if (!clear) return;

      const formData = new FormData();
      formData.append('date', data.date);
      formData.append('amount', data.amount);
      formData.append('categoryId', splits ? '' : data.categoryId || '');
      formData.append('accountId', data.accountId);
      formData.append('merchantOrSource', data.merchantOrSource || '');
      formData.append('notes', data.notes || '');
      formData.append('tags', data.tags || '');
      formData.append('source', 'receipt');
      if (splits) {
        formData.append(
          'splitItems',
          JSON.stringify(splits.map((s) => ({ categoryId: s.categoryId, amount: Number(s.amount), notes: s.notes })))
        );
      }
      const result = await createExpense(formData);
      if (result.success) {
        duplicateGuard.reset();
        notifyReviewChanged();
        onSuccess();
      } else {
        setSubmitError(result.error || 'Failed to create expense');
      }
    } catch {
      setSubmitError('Could not save. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const confidenceColors = {
    high: 'bg-mint-dim text-mint border-mint/25',
    medium: 'bg-warning-dim text-warning border-warning/25',
    low: 'bg-danger-dim text-danger border-danger/25',
  };

  if (step === 'upload') {
    return (
      <div className="space-y-4">
        <div className="text-center mb-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-info-dim text-info rounded-full text-sm font-medium">
            <Sparkles size={16} />
            Receipt scanner
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void processFile(file);
          }}
          className="border-2 border-dashed border-graphite-border rounded-xl p-8 text-center hover:border-mint/50 hover:bg-mint-dim transition-all cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-mint-dim flex items-center justify-center">
              <ImageIcon size={28} className="text-mint" />
            </div>
            <div>
              <p className="text-base font-medium text-ink-secondary">Drop receipt image here or click to browse</p>
              <p className="text-sm text-ink-muted mt-1">Supports JPG, PNG, WEBP up to 10MB</p>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => e.target.files?.[0] && void processFile(e.target.files[0])}
          className="hidden"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => e.target.files?.[0] && void processFile(e.target.files[0])}
          className="hidden"
        />

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-graphite-border rounded-xl hover:border-mint/50 hover:bg-graphite-surface-2/60 transition-all text-ink-secondary"
          >
            <Upload size={20} />
            <span className="text-sm font-medium">Upload Image</span>
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-graphite-border rounded-xl hover:border-mint/50 hover:bg-graphite-surface-2/60 transition-all text-ink-secondary"
          >
            <Camera size={20} />
            <span className="text-sm font-medium">Take Photo</span>
          </button>
        </div>

        <p className="text-xs text-ink-muted">
          Works with store receipts, restaurant bills, order confirmations and payment screenshots. You review the
          draft before anything is saved.
        </p>

        <div className="flex justify-end pt-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'scanning') {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        {imagePreview && (
          <div className="w-32 h-32 rounded-lg overflow-hidden border-2 border-graphite-border mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreview} alt="Receipt" className="w-full h-full object-cover" />
          </div>
        )}
        <Loader2 size={40} className="text-mint animate-spin" />
        <div className="text-center">
          <p className="text-lg font-medium text-ink font-display">Reading the receipt…</p>
          <p className="text-sm text-ink-muted mt-1">This usually takes a few seconds</p>
        </div>
        <Button type="button" variant="ghost" onClick={handleRetry}>
          Cancel
        </Button>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <div className="w-16 h-16 rounded-full bg-danger-dim flex items-center justify-center">
          <AlertCircle size={32} className="text-danger" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-ink font-display">Could not read it</p>
          <p className="text-sm text-ink-secondary mt-1 max-w-sm">{scanError}</p>
        </div>
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleRetry}>
            <RotateCcw size={18} className="inline mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // step === 'review'
  return (
    <div className="space-y-4">
      {draft && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-mint" />
            <span className="text-sm font-medium text-ink-secondary">Receipt read</span>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${confidenceColors[draft.confidence]}`}
          >
            {draft.confidence} confidence
          </span>
        </div>
      )}

      <div className="flex gap-3">
        {imagePreview && (
          <div className="w-20 h-20 rounded-lg overflow-hidden border border-graphite-border flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreview} alt="Receipt" className="w-full h-full object-cover" />
          </div>
        )}
        {draft && draft.items.length > 0 && (
          <div className="flex-1 bg-graphite-surface-2/60 rounded-lg p-2.5 max-h-20 overflow-y-auto">
            <p className="text-xs font-medium text-ink-muted mb-1">Items read:</p>
            <div className="space-y-0.5">
              {draft.items.map((item, i) => (
                <div key={i} className="flex justify-between text-xs text-ink-secondary">
                  <span className="truncate mr-2">{item.name}</span>
                  <span className="font-medium flex-shrink-0 money">{formatCurrency(item.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {draft && draft.issues.length > 0 && (
        <ul className="rounded-xl border border-info/25 bg-info-dim px-3 py-2 space-y-1" aria-label="Things to check">
          {draft.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-2 text-xs text-info">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {issue}
            </li>
          ))}
        </ul>
      )}

      {submitError && (
        <div role="alert" className="p-3 bg-danger-dim border border-danger/25 rounded-xl text-danger text-sm">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Date" type="date" {...register('date')} error={errors.date?.message} />
          <Input
            label="Amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            {...register('amount')}
            error={errors.amount?.message}
            placeholder="0.00"
          />
        </div>

        {splits ? (
          <div className="rounded-2xl border border-graphite-border-subtle bg-graphite-surface-2/40 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink-secondary">Split by category</p>
              <button type="button" onClick={stopSplitting} className="text-xs text-mint hover:underline">
                Use one category instead
              </button>
            </div>
            {splits.map((row, index) => (
              <div key={index} className="space-y-1">
                <div className="flex items-center gap-2">
                  <select
                    value={row.categoryId}
                    onChange={(e) =>
                      setSplits(splits.map((s, i) => (i === index ? { ...s, categoryId: e.target.value } : s)))
                    }
                    aria-label={`Category for part ${index + 1}`}
                    className="min-w-0 flex-1 rounded-xl border border-graphite-border bg-[var(--surface-2)] px-3 py-2.5 text-base sm:text-sm text-ink focus:outline-none focus:ring-2 focus:ring-mint/30 [color-scheme:dark]"
                  >
                    {categoryOptions.map((o) => (
                      <option key={o.value} value={o.value} className="bg-[var(--surface)]">
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="relative w-28 shrink-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) =>
                        setSplits(splits.map((s, i) => (i === index ? { ...s, amount: e.target.value } : s)))
                      }
                      aria-label={`Amount for part ${index + 1}`}
                      className="w-full rounded-xl border border-graphite-border bg-[var(--surface-2)] py-2.5 pl-6 pr-3 text-right text-base sm:text-sm text-ink money focus:outline-none focus:ring-2 focus:ring-mint/30"
                    />
                  </div>
                </div>
                {row.notes && <p className="truncate pl-1 text-xs text-ink-muted">{row.notes}</p>}
              </div>
            ))}
            <p className={`text-xs ${splitMismatch ? 'text-danger' : 'text-ink-muted'}`} role={splitMismatch ? 'alert' : undefined}>
              Parts add up to <span className="money">{formatCurrency(splitTotalCents / 100)}</span>
              {splitMismatch
                ? `, but the total is ${formatCurrency(Number(amountVal) || 0)}. Change a part or the total.`
                : ', the total.'}
            </p>
          </div>
        ) : (
          <Select
            label="Category"
            {...register('categoryId')}
            error={errors.categoryId?.message}
            options={[{ value: '', label: 'Select category...' }, ...categoryOptions]}
          />
        )}

        <Select
          label="Account"
          {...register('accountId')}
          error={errors.accountId?.message}
          options={[{ value: '', label: 'Select account...' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />

        <Input
          label="Merchant"
          {...register('merchantOrSource')}
          error={errors.merchantOrSource?.message}
          placeholder="e.g., Walmart"
        />

        <Textarea label="Notes" {...register('notes')} rows={2} placeholder="Add notes..." />

        <Input
          label="Tags (comma-separated)"
          {...register('tags')}
          error={errors.tags?.message}
          placeholder="e.g., business, deductible"
        />

        <DuplicateWarning
          match={duplicateGuard.match}
          busy={isSubmitting}
          onCancel={duplicateGuard.reset}
          onSaveAnyway={() => {
            duplicateGuard.confirm();
            void handleSubmit(onSubmit)();
          }}
        />

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button type="submit" disabled={isSubmitting} className="flex-1 w-full">
            {isSubmitting ? 'Saving...' : 'Add Expense'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleRetry} className="flex-1 w-full">
            <RotateCcw size={16} className="inline mr-1" />
            Scan Another
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} className="sm:flex-none">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
