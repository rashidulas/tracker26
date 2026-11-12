import PageHeader from '@/components/PageHeader';
import TabNav from '@/components/TabNav';

const tabs = [
  { href: '/plan/budgets', label: 'Budgets' },
  { href: '/plan/goals', label: 'Goals' },
];

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <PageHeader title="Plan" subtitle="Monthly budgets and savings goals" />
      <TabNav tabs={tabs} label="Plan views" />
      {children}
    </div>
  );
}
