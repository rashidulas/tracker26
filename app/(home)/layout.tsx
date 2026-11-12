import PageHeader from '@/components/PageHeader';
import TabNav from '@/components/TabNav';

const tabs = [
  { href: '/', label: 'Overview', exact: true },
  { href: '/insights', label: 'Insights' },
];

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <PageHeader title="Home" subtitle="Your money at a glance" />
      <TabNav tabs={tabs} label="Home views" />
      {children}
    </div>
  );
}
