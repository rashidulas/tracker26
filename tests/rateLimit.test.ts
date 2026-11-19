/**
 * The in-memory rate limiter and the request size guard.
 *
 * Run: npm test (vitest)
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';

import { base64Bytes, readLimitedBody, tooManyRequests } from '../lib/http';
import { createRateLimiter, limiter, retryAfterText } from '../lib/rateLimit';

function clock(start = 1_000_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => void (at += ms) };
}

test('allows up to the limit, then refuses with a retry time', () => {
  const time = clock();
  const limit = createRateLimiter({ limit: 3, windowMs: 60_000, now: time.now });

  assert.deepEqual(limit.consume('a'), { ok: true, remaining: 2, retryAfterSeconds: 0 });
  time.advance(10_000);
  assert.equal(limit.consume('a').remaining, 1);
  assert.equal(limit.consume('a').remaining, 0);

  const refused = limit.consume('a');
  assert.equal(refused.ok, false);
  // The first call leaves the window 50 seconds from now.
  assert.equal(refused.retryAfterSeconds, 50);
});

test('the window slides: calls are allowed again as old ones age out', () => {
  const time = clock();
  const limit = createRateLimiter({ limit: 2, windowMs: 60_000, now: time.now });
  limit.consume('a');
  time.advance(30_000);
  limit.consume('a');
  assert.equal(limit.consume('a').ok, false);

  time.advance(30_001);
  assert.equal(limit.consume('a').ok, true);
  assert.equal(limit.consume('a').ok, false);

  time.advance(60_001);
  assert.equal(limit.peek('a').remaining, 2);
});

test('a refused call is not counted, so the lockout does not extend itself', () => {
  const time = clock();
  const limit = createRateLimiter({ limit: 1, windowMs: 60_000, now: time.now });
  limit.consume('a');
  for (let i = 0; i < 20; i += 1) {
    time.advance(1000);
    assert.equal(limit.consume('a').ok, false);
  }
  time.advance(40_001);
  assert.equal(limit.consume('a').ok, true);
});

test('keys are separate, peek does not count, reset clears', () => {
  const time = clock();
  const limit = createRateLimiter({ limit: 1, windowMs: 60_000, now: time.now });
  assert.equal(limit.peek('a').ok, true);
  assert.equal(limit.peek('a').ok, true);
  assert.equal(limit.consume('a').ok, true);
  assert.equal(limit.peek('a').ok, false);
  assert.equal(limit.consume('b').ok, true);

  limit.reset('a');
  assert.equal(limit.consume('a').ok, true);
});

test('the number of tracked keys is bounded', () => {
  const time = clock();
  const limit = createRateLimiter({ limit: 1, windowMs: 60_000, now: time.now, maxKeys: 3 });
  for (const key of ['a', 'b', 'c', 'd']) limit.consume(key);
  // "a" was the least recently used and was dropped.
  assert.equal(limit.peek('a').ok, true);
  assert.equal(limit.peek('d').ok, false);
});

test('login attempts lock after five failures from one address', () => {
  const attempts = limiter('loginAddress');
  const address = `test-${Math.random()}`;
  for (let i = 0; i < 5; i += 1) assert.equal(attempts.consume(address).ok, true);
  const locked = attempts.peek(address);
  assert.equal(locked.ok, false);
  assert.ok(locked.retryAfterSeconds > 14 * 60 && locked.retryAfterSeconds <= 15 * 60);
  assert.equal(attempts.peek(`other-${address}`).ok, true);
  attempts.reset(address);
});

test('an AI route answers 429 with Retry-After once its limit is used up', async () => {
  let refused: Response | null = null;
  // scanReceipt allows 12 a minute.
  for (let i = 0; i < 12; i += 1) assert.equal(tooManyRequests('scanReceipt'), null);
  refused = tooManyRequests('scanReceipt');
  assert.equal(refused?.status, 429);
  assert.ok(Number(refused!.headers.get('retry-after')) > 0);
  assert.match(((await refused!.json()) as { error: string }).error, /Too many requests/);
  limiter('scanReceipt').reset('app');
});

test('retry text reads naturally', () => {
  assert.equal(retryAfterText(1), 'in 1 second');
  assert.equal(retryAfterText(40), 'in 40 seconds');
  assert.equal(retryAfterText(600), 'in 10 minutes');
});

// ==================== REQUEST SIZE ====================

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { method: 'POST', body, headers });

test('a body within the limit is read in full', async () => {
  const result = await readLimitedBody(post(JSON.stringify({ hello: 'world' })), 1024);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(new TextDecoder().decode((result as { bytes: Uint8Array }).bytes)), { hello: 'world' });
});

test('a body over the limit is refused, by its header or by its real size', async () => {
  const big = 'x'.repeat(5000);
  assert.deepEqual(await readLimitedBody(post(big), 1024), { ok: false, reason: 'too-large' });

  // A Content-Length that understates the body does not get it through.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 10; i += 1) controller.enqueue(new TextEncoder().encode('y'.repeat(500)));
      controller.close();
    },
  });
  const lying = new Request('http://localhost/api/x', {
    method: 'POST',
    body: stream,
    headers: { 'content-length': '10' },
    duplex: 'half',
  } as RequestInit);
  assert.deepEqual(await readLimitedBody(lying, 1024), { ok: false, reason: 'too-large' });
});

test('base64 size is computed without decoding', () => {
  for (const length of [0, 1, 2, 3, 4, 100, 1001]) {
    const encoded = Buffer.alloc(length, 7).toString('base64');
    assert.equal(base64Bytes(encoded), length);
  }
});
