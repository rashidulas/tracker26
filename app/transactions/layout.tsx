import PageHeader from '@/components/PageHeader';
import TabNav from '@/components/TabNav';

const tabs = [
  { href: '/transactions/expenses', label: 'Expenses' },
  { href: '/transactions/income', label: 'Income' },
  { href: '/transactions/transfers', label: 'Transfers' },
];

export default function TransactionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <PageHeader title="Transactions" subtitle="Everything you spend, earn and move" />
      <TabNav tabs={tabs} label="Transaction type" />
      {children}
    </div>
  );
}
