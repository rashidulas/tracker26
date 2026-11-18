import { generateId } from 'ai';
import FinanceAssistant from '@/components/assistant/FinanceAssistant';
import { listConversations, loadConversation } from '@/lib/assistant/conversations';
import { loadChatReference, loadStarterPrompts } from '@/lib/assistant/starters';
import { getAppTimeZone, todayInAppTimeZone } from '@/lib/dates';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function greetingFor(now: Date) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: getAppTimeZone() }).format(now)
  );
  if (hour < 5) return 'Up late? What can I look into?';
  if (hour < 12) return 'Good morning. What would you like to know?';
  if (hour < 18) return 'Good afternoon. What would you like to know?';
  return 'Good evening. What would you like to know?';
}

/** /chat is a new chat; /chat/<id> opens a stored one. */
export default async function ChatPage({ params }: { params: Promise<{ id?: string[] }> }) {
  const { id } = await params;
  const requested = id?.[0];
  const today = todayInAppTimeZone();

  const [conversations, conversation, starters, reference] = await Promise.all([
    listConversations(prisma),
    requested ? loadConversation(prisma, requested) : null,
    loadStarterPrompts(prisma, today),
    loadChatReference(prisma),
  ]);

  return (
    <FinanceAssistant
      conversations={conversations}
      conversation={conversation}
      freshId={generateId()}
      starters={starters}
      reference={reference}
      today={today}
      greeting={greetingFor(new Date())}
    />
  );
}
