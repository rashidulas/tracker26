'use client';

import { RouteError } from '@/components/RouteStates';

export default function ExpensesError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} title="Couldn’t load expenses" />;
}
