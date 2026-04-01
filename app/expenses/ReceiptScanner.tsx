'use client';

import { useState, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Input from '@/components/Input';
import Select from '@/components/Select';
import Button from '@/components/Button';
import { createExpense } from './actions';
import {
  Camera,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  ImageIcon,
  Sparkles,
  RotateCcw,
} from 'lucide-react';

const reviewSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amount: z.string().min(1, 'Amount is required'),
  categoryId: z.string().min(1, 'Category is required'),
  accountId: z.string().min(1, 'Account is required'),
  merchantOrSource: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional(),
});

type ReviewFormData = z.infer<typeof reviewSchema>;

interface ReceiptScannerProps {
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  onSuccess: () => void;
  onCancel: () => void;
}

type ScanStep = 'upload' | 'scanning' | 'review' | 'error';

interface ScanResult {
  merchant: string;
  date: string;
  totalAmount: number;
  category: string;
  items: Array<{ name: string; amount: number; suggestedCategory: string }>;
  notes: string;
  tags: string[];
  confidence: 'high' | 'medium' | 'low';
}

export default function ReceiptScanner({
  categories,
  accounts,
  onSuccess,
  onCancel,
}: ReceiptScannerProps) {
  const [step, setStep] = useState<ScanStep>('upload');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ReviewFormData>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      date: new Date().toISOString().split('T')[0],
      amount: '',
      categoryId: '',
      accountId: accounts.length > 0 ? accounts[0].id : '',
      merchantOrSource: '',
      notes: '',
      tags: '',
    },
  });

  const findCategoryId = useCallback(
    (categoryName: string): string => {
      const normalized = categoryName.toLowerCase().trim();
      const match = categories.find(
        (c) => c.name.toLowerCase() === normalized
      );
      if (match) return match.id;

      const partialMatch = categories.find(
        (c) =>
          c.name.toLowerCase().includes(normalized) ||
          normalized.includes(c.name.toLowerCase())
      );
      if (partialMatch) return partialMatch.id;

      const keywordMap: Record<string, string[]> = {
        groceries: ['grocery', 'supermarket', 'market', 'shampoo', 'soap', 'food', 'produce'],
        'dining out': ['restaurant', 'cafe', 'coffee', 'fast food', 'takeout', 'outside food', 'dine'],
        transportation: ['gas', 'uber', 'lyft', 'taxi', 'parking', 'bus', 'train'],
        utilities: ['electric', 'water', 'internet', 'phone', 'utility'],
        healthcare: ['pharmacy', 'doctor', 'medical', 'prescription', 'health'],
        entertainment: ['movie', 'game', 'stream', 'netflix', 'spotify', 'concert'],
        shopping: ['amazon', 'clothing', 'electronics', 'online', 'shop', 'store'],
        travel: ['flight', 'hotel', 'airbnb', 'vacation'],
        education: ['course', 'book', 'tuition', 'school'],
        insurance: ['insurance'],
      };

      for (const [catKey, keywords] of Object.entries(keywordMap)) {
        if (keywords.some((kw) => normalized.includes(kw))) {
          const found = categories.find(
            (c) => c.name.toLowerCase() === catKey
          );
          if (found) return found.id;
        }
      }

      return categories.length > 0 ? categories[categories.length - 1].id : '';
    },
    [categories]
  );

  const processImage = async (base64Image: string, mimeType: string) => {
    setStep('scanning');
    setScanError('');

    try {
      const response = await fetch('/api/scan-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image, mimeType }),
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || 'Failed to scan receipt');
      }

      const data: ScanResult = result.data;
      setScanResult(data);

      setValue('merchantOrSource', data.merchant || '');
      setValue('date', data.date || new Date().toISOString().split('T')[0]);
      setValue('amount', data.totalAmount?.toString() || '');
      setValue('categoryId', findCategoryId(data.category || ''));
      setValue('notes', data.notes || '');
      setValue('tags', data.tags?.join(', ') || '');

      if (accounts.length > 0) {
        setValue('accountId', accounts[0].id);
      }

      setStep('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to scan receipt';
      setScanError(message);
      setStep('error');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setImagePreview(base64);
      processImage(base64, file.type);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setImagePreview(base64);
        processImage(base64, file.type);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRetry = () => {
    setStep('upload');
    setImagePreview(null);
    setScanResult(null);
    setScanError('');
    setSubmitError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const onSubmit = async (data: ReviewFormData) => {
    setIsSubmitting(true);
    setSubmitError('');

    const formData = new FormData();
    formData.append('date', data.date);
    formData.append('amount', data.amount);
    formData.append('categoryId', data.categoryId);
    formData.append('accountId', data.accountId);
    formData.append('merchantOrSource', data.merchantOrSource || '');
    formData.append('notes', data.notes || '');
    formData.append('tags', data.tags || '');

    const result = await createExpense(formData);
    setIsSubmitting(false);

    if (result.success) {
      onSuccess();
    } else {
      setSubmitError(result.error || 'Failed to create expense');
    }
  };

  const confidenceColors = {
    high: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    low: 'bg-red-500/10 text-red-400 border-red-500/20',
  };

  if (step === 'upload') {
    return (
      <div className="space-y-4">
        <div className="text-center mb-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 text-purple-400 rounded-full text-sm font-medium">
            <Sparkles size={16} />
            AI-Powered Receipt Scanner
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <ImageIcon size={28} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-base font-medium text-zinc-300">
                Drop receipt image here or click to browse
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                Supports JPG, PNG, WEBP up to 10MB
              </p>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-zinc-700 rounded-xl hover:border-emerald-500/50 hover:bg-zinc-800/50 transition-all text-zinc-300"
          >
            <Upload size={20} />
            <span className="text-sm font-medium">Upload Image</span>
          </button>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-zinc-700 rounded-xl hover:border-emerald-500/50 hover:bg-zinc-800/50 transition-all text-zinc-300"
          >
            <Camera size={20} />
            <span className="text-sm font-medium">Take Photo</span>
          </button>
        </div>

        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-400 font-medium mb-1.5">Works with:</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              'Store receipts',
              'Apple Pay screenshots',
              'Google Pay',
              'Bank notifications',
              'Restaurant bills',
              'Online order confirmations',
            ].map((item) => (
              <span
                key={item}
                className="inline-block px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-400"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

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
          <div className="w-32 h-32 rounded-lg overflow-hidden border-2 border-zinc-700 mb-2">
            <img
              src={imagePreview}
              alt="Receipt"
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="relative">
          <Loader2 size={40} className="text-emerald-400 animate-spin" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-white">Scanning receipt...</p>
          <p className="text-sm text-zinc-500 mt-1">
            AI is reading and categorizing your expense
          </p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
          <AlertCircle size={32} className="text-red-400" />
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-white">Scan Failed</p>
          <p className="text-sm text-zinc-400 mt-1 max-w-sm">{scanError}</p>
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
      {/* AI Confidence Badge */}
      {scanResult && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-400" />
            <span className="text-sm font-medium text-zinc-300">Receipt scanned</span>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
              confidenceColors[scanResult.confidence]
            }`}
          >
            {scanResult.confidence} confidence
          </span>
        </div>
      )}

      {/* Image + Items Preview */}
      <div className="flex gap-3">
        {imagePreview && (
          <div className="w-20 h-20 rounded-lg overflow-hidden border border-zinc-700 flex-shrink-0">
            <img
              src={imagePreview}
              alt="Receipt"
              className="w-full h-full object-cover"
            />
          </div>
        )}
        {scanResult?.items && scanResult.items.length > 0 && (
          <div className="flex-1 bg-zinc-800/50 rounded-lg p-2.5 max-h-20 overflow-y-auto">
            <p className="text-xs font-medium text-zinc-500 mb-1">Detected items:</p>
            <div className="space-y-0.5">
              {scanResult.items.map((item, i) => (
                <div key={i} className="flex justify-between text-xs text-zinc-300">
                  <span className="truncate mr-2">{item.name}</span>
                  <span className="font-medium flex-shrink-0">${item.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {submitError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {submitError}
        </div>
      )}

      {/* Editable Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-blue-400">
            Review the auto-filled fields below. Edit anything that looks incorrect before submitting.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            {...register('date')}
            error={errors.date?.message}
          />
          <Input
            label="Amount"
            type="number"
            step="0.01"
            {...register('amount')}
            error={errors.amount?.message}
            placeholder="0.00"
          />
        </div>

        <Select
          label="Category"
          {...register('categoryId')}
          error={errors.categoryId?.message}
          options={[
            { value: '', label: 'Select category...' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        <Select
          label="Account"
          {...register('accountId')}
          error={errors.accountId?.message}
          options={[
            { value: '', label: 'Select account...' },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
        />

        <Input
          label="Merchant"
          {...register('merchantOrSource')}
          error={errors.merchantOrSource?.message}
          placeholder="e.g., Walmart"
        />

        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1">
            Notes
          </label>
          <textarea
            {...register('notes')}
            className="w-full px-3 py-2 border border-zinc-700 bg-zinc-800/50 text-zinc-100 rounded-lg focus:ring-2 focus:ring-emerald-500/40 focus:outline-none text-sm"
            rows={2}
            placeholder="Add notes..."
          />
        </div>

        <Input
          label="Tags (comma-separated)"
          {...register('tags')}
          error={errors.tags?.message}
          placeholder="e.g., business, deductible"
        />

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button type="submit" disabled={isSubmitting} className="flex-1 w-full">
            {isSubmitting ? 'Saving...' : 'Add Expense'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleRetry}
            className="flex-1 w-full"
          >
            <RotateCcw size={16} className="inline mr-1" />
            Scan Another
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="sm:flex-none"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
