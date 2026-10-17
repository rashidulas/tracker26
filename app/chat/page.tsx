import PageHeader from '@/components/PageHeader';
import FinanceAssistant from '@/components/assistant/FinanceAssistant';

export default function ChatPage() {
  return (
    <div className="page-shell flex flex-col min-h-[calc(100dvh-3.5rem)] lg:min-h-screen">
      <PageHeader
        title="Chat"
        subtitle="Ask about your money or log expenses and income"
      />
      <div className="flex-1 min-h-0">
        <FinanceAssistant variant="page" />
      </div>
    </div>
  );
}
