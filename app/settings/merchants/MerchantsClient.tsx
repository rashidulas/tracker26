'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Store, Pencil } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import TabNav from '@/components/TabNav';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import Input from '@/components/Input';
import Select from '@/components/Select';
import { useToast } from '@/components/ToastProvider';
import { updateMerchantDefaults, type MerchantsPageData } from './actions';
import { SETTINGS_TABS } from '../tabs';

type Merchant = MerchantsPageData['merchants'][number];

export default function MerchantsClient({ data }: { data: MerchantsPageData }) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'defaults'>('all');
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [form, setForm] = useState({ categoryId: '', subcategoryId: '', accountId: '' });
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.merchants
      .filter((m) => !q || m.name.toLowerCase().includes(q))
      .filter((m) => filter === 'all' || m.defaultCategoryId || m.defaultAccountId)
      .sort((a, b) => b.transactionCount - a.transactionCount || a.name.localeCompare(b.name));
  }, [data.merchants, query, filter]);

  const withDefaults = data.merchants.filter((m) => m.defaultCategoryId || m.defaultAccountId).length;
  const subcategories = data.categories.find((c) => c.id === form.categoryId)?.subcategories ?? [];

  const openEdit = (m: Merchant) => {
    setEditing(m);
    setForm({
      categoryId: m.defaultCategoryId ?? '',
      subcategoryId: m.defaultSubcategoryId ?? '',
      accountId: m.defaultAccountId ?? '',
    });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    const result = await updateMerchantDefaults(editing.id, {
      categoryId: form.categoryId || null,
      subcategoryId: form.subcategoryId || null,
      accountId: form.accountId || null,
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Saved defaults for ${editing.name}`);
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="page-shell">
      <PageHeader title="Settings" subtitle="Categories and merchant memory" />
      <TabNav tabs={SETTINGS_TABS} label="Settings sections" />

      <div className="space-y-4">
        <p className="text-sm text-ink-secondary max-w-2xl">
          Each merchant can remember a default category and account. They fill in the expense form when
          you type the merchant, and the assistant and receipt scanner use them too. Without a default, the
          form uses whatever you picked last time.
        </p>

        {data.unlinked > 0 && (
          <div role="status" className="p-3.5 rounded-xl border border-warning/25 bg-warning-dim text-sm text-warning">
            {data.unlinked} older transaction{data.unlinked === 1 ? ' is' : 's are'} not linked to a merchant
            yet. Run the merchant migration (<code className="font-mono text-xs">npm run migrate:merchants</code>)
            to link them.
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <Input
              aria-label="Search merchants"
              placeholder="Search merchants"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="!pl-10"
            />
          </div>
          <div className="inline-flex p-1 rounded-xl bg-graphite-surface-2/90 border border-graphite-border-subtle" role="group" aria-label="Filter merchants">
            {(
              [
                ['all', `All (${data.merchants.length})`],
                ['defaults', `With defaults (${withDefaults})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  filter === value ? 'bg-mint-dim text-mint font-medium' : 'text-ink-secondary hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="panel shadow-panel px-4 sm:px-5" aria-label="Merchants">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-ink-muted">
              <Store size={26} className="mb-2 opacity-40" aria-hidden="true" />
              <p className="text-sm">
                {data.merchants.length === 0 ? 'No merchants yet. They appear as you add expenses.' : 'No matches.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-graphite-border-subtle">
              {visible.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink truncate">{m.name}</p>
                    <p className="text-xs text-ink-muted truncate">
                      {m.transactionCount} transaction{m.transactionCount === 1 ? '' : 's'}
                      {m.defaultCategory &&
                        ` · ${m.defaultCategory.icon ?? ''} ${m.defaultCategory.name}${
                          m.defaultSubcategory ? ` › ${m.defaultSubcategory.name}` : ''
                        }`}
                      {m.defaultAccount && ` · ${m.defaultAccount.name}`}
                      {!m.defaultCategory && !m.defaultAccount && ' · no defaults'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(m)} aria-label={`Edit defaults for ${m.name}`}>
                    <Pencil size={15} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Defaults for ${editing.name}` : 'Defaults'}
        description="Used whenever you enter this merchant. Leave empty to use what you picked last time."
        footer={
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" form="merchant-defaults-form" disabled={saving} className="flex-1">
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <form id="merchant-defaults-form" onSubmit={save} className="space-y-4">
          <Select
            label="Default category"
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value, subcategoryId: '' })}
            options={[
              { value: '', label: 'None' },
              ...data.categories.map((c) => ({
                value: c.id,
                label: `${c.icon ?? ''} ${c.name}${c.type === 'INCOME' ? ' (income)' : ''}`.trim(),
              })),
            ]}
          />
          {subcategories.length > 0 && (
            <Select
              label="Default subcategory"
              value={form.subcategoryId}
              onChange={(e) => setForm({ ...form, subcategoryId: e.target.value })}
              options={[{ value: '', label: 'None' }, ...subcategories.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
          <Select
            label="Default account"
            value={form.accountId}
            onChange={(e) => setForm({ ...form, accountId: e.target.value })}
            options={[{ value: '', label: 'None' }, ...data.accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </form>
      </Modal>
    </div>
  );
}
