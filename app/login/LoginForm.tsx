'use client';

import { useActionState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { signIn, type SignInState } from './actions';

const initialState: SignInState = {};

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      {/* Lets a password manager file the password under a name. */}
      <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        maxLength={256}
        error={state.error}
      />

      <label className="flex items-center gap-2.5 min-h-[44px] text-sm text-ink-secondary cursor-pointer select-none">
        <input
          type="checkbox"
          name="remember"
          defaultChecked
          className="h-4 w-4 rounded border-graphite-border accent-[var(--mint)]"
        />
        Stay signed in on this device
      </label>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <LogIn size={18} aria-hidden="true" />
        )}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
