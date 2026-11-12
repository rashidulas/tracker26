'use client';

import { RouteError } from '@/components/RouteStates';

export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} title="Couldn’t load dashboard" />;
}
