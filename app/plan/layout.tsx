import PageHeader from '@/components/PageHeader';
import TabNav from '@/components/TabNav';

const tabs = [
  { href: '/plan/budgets', label: 'Budgets' },
  { href: '/plan/goals', label: 'Goals' },
  { href: '/plan/recurring', label: 'Recurring' },
  { href: '/plan/reminders', label: 'Reminders', badge: 'reminders' as const },
];

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <PageHeader title="Plan" subtitle="Budgets, savings goals, recurring entries and reminders" />
      <TabNav tabs={tabs} label="Plan views" />
      {children}
    </div>
  );
}
