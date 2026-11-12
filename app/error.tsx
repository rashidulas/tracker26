'use client';

import { RouteError } from '@/components/RouteStates';

export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} />;
}
