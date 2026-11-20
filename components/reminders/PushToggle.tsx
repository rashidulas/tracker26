'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, Send } from 'lucide-react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
  type RemindersPageData,
} from '@/app/plan/reminders/actions';

type Status =
  | 'checking'
  /** The server has no keys. */
  | 'server-off'
  /** No service worker / push in this browser (or not installed on iOS). */
  | 'unsupported'
  | 'blocked'
  | 'off'
  | 'on';

function decodeKey(base64url: string) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function encode(buffer: ArrayBuffer | null) {
  if (!buffer) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
    ? 'iPad'
    : /Android/.test(ua)
    ? 'Android'
    : /Mac/.test(ua)
    ? 'Mac'
    : /Windows/.test(ua)
    ? 'Windows'
    : 'This device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
    ? 'Firefox'
    : /Chrome\//.test(ua)
    ? 'Chrome'
    : /Safari\//.test(ua)
    ? 'Safari'
    : '';
  return browser ? `${device} · ${browser}` : device;
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Turns reminder notifications on or off for this browser, and lists the
 * devices that have them on.
 */
export default function PushToggle({ push }: { push: RemindersPageData['push'] }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<Status>('checking');
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!push.publicKey) return setStatus('server-off');
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return setStatus('unsupported');
      }
      if (Notification.permission === 'denied') return setStatus('blocked');
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (cancelled) return;
      setEndpoint(subscription?.endpoint ?? null);
      // On only when the server still knows this subscription.
      setStatus(
        subscription && push.devices.some((d) => d.endpoint === subscription.endpoint) ? 'on' : 'off'
      );
    };
    void check().catch(() => !cancelled && setStatus('unsupported'));
    return () => {
      cancelled = true;
    };
  }, [push.publicKey, push.devices]);

  const turnOn = async () => {
    if (!push.publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(push.publicKey),
        }));
      const result = await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: encode(subscription.getKey('p256dh')),
        auth: encode(subscription.getKey('auth')),
        label: deviceLabel(),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEndpoint(subscription.endpoint);
      setStatus('on');
      toast.success('Notifications are on for this device');
      router.refresh();
    } catch (error) {
      console.error('Could not subscribe to notifications:', error);
      toast.error('Could not turn notifications on in this browser');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (target: string) => {
    setBusy(true);
    try {
      if (target === endpoint) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
        setStatus('off');
      }
      const result = await removePushSubscription(target);
      if (!result.success) toast.error(result.error);
      else toast.success('Notifications turned off');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    const result = await sendTestPush();
    setBusy(false);
    if (result.success) toast.success('Test notification sent');
    else toast.error(result.error);
  };

  const explain: Record<Status, string> = {
    checking: 'Checking this browser…',
    'server-off':
      'Notifications are not set up on the server yet (VAPID keys missing). Reminders still show here and when you open the app.',
    unsupported:
      typeof navigator !== 'undefined' && isIos() && !isInstalled()
        ? 'On iPhone, first add Tracker26 to your Home Screen (Share › Add to Home Screen), open it from there, then turn notifications on.'
        : 'This browser cannot receive notifications. Reminders still show when you open the app.',
    blocked: 'Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.',
    off: 'Get a notification before a payment is due, on the day, and if it goes overdue, even when the app is closed.',
    on: 'This device gets a notification before a payment is due, on the day, and if it goes overdue.',
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <p className="text-sm text-ink-secondary flex-1">{explain[status]}</p>
        {status === 'off' && (
          <Button onClick={() => void turnOn()} disabled={busy} className="w-full sm:w-auto shrink-0">
            <Bell size={16} aria-hidden="true" />
            Turn on notifications
          </Button>
        )}
        {status === 'on' && (
          <div className="flex gap-2 shrink-0">
            <Button variant="secondary" onClick={() => void test()} disabled={busy}>
              <Send size={15} aria-hidden="true" />
              Send a test
            </Button>
            <Button variant="ghost" onClick={() => endpoint && void turnOff(endpoint)} disabled={busy}>
              <BellOff size={15} aria-hidden="true" />
              Turn off
            </Button>
          </div>
        )}
      </div>
      {push.devices.length > 0 && (
        <ul className="mt-4 divide-y divide-graphite-border-subtle border-t border-graphite-border-subtle">
          {push.devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 py-2.5">
              <Bell size={14} className="text-mint shrink-0" aria-hidden="true" />
              <p className="text-sm text-ink flex-1 min-w-0 truncate">
                {device.label ?? 'A device'}
                {device.endpoint === endpoint && <span className="text-ink-muted"> (this one)</span>}
              </p>
              {device.endpoint !== endpoint && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void turnOff(device.endpoint)}
                  disabled={busy}
                  aria-label={`Turn off notifications on ${device.label ?? 'this device'}`}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
