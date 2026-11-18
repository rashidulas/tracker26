/**
 * The pure helpers behind the chat screen: status chip wording, follow-up
 * suggestions, and what gets stored of a reply.
 *
 * Run: npm test (vitest)
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';

import { mergeIncoming, storableReply } from '../lib/assistant/chat';
import { placeholderTitle, type StoredMessage } from '../lib/assistant/conversations';
import { followUpsFor } from '../lib/assistant/followUps';
import { describeRange, toolActivityLabel } from '../lib/assistant/toolLabels';

const TODAY = '2026-11-17';

test('date ranges are described the way a person would say them', () => {
  assert.equal(describeRange('2026-03-01', '2026-03-31', TODAY), 'March');
  assert.equal(describeRange('2025-03-01', '2025-03-31', TODAY), 'March 2025');
  assert.equal(describeRange('2024-02-01', '2024-02-29', TODAY), 'February 2024');
  assert.equal(describeRange('2026-11-17', '2026-11-17', TODAY), 'today');
  assert.equal(describeRange('2026-11-16', '2026-11-16', TODAY), 'yesterday');
  assert.equal(describeRange('2026-11-01', '2026-11-17', TODAY), 'this month');
  assert.equal(describeRange('2026-01-01', '2026-11-17', TODAY), 'this year');
  assert.equal(describeRange('2025-01-01', '2025-12-31', TODAY), '2025');
  assert.equal(describeRange('2026-03-03', '2026-03-09', TODAY), 'Mar 3 – Mar 9');
  assert.equal(describeRange('2025-12-20', '2026-01-05', TODAY), 'Dec 20, 2025 – Jan 5, 2026');
  // Not a range worth describing.
  assert.equal(describeRange('2026-02-30', '2026-03-01', TODAY), undefined);
  assert.equal(describeRange('2026-03-09', '2026-03-03', TODAY), undefined);
  assert.equal(describeRange(undefined, '2026-03-03', TODAY), undefined);
});

test('status chips say what is being looked at, before and after', () => {
  assert.deepEqual(
    toolActivityLabel('summarizeTransactions', { kind: 'EXPENSE', start: '2026-03-01', end: '2026-03-31' }, TODAY),
    { running: 'Looking at March spending', done: 'Looked at March spending' }
  );
  assert.equal(
    toolActivityLabel('summarizeTransactions', { kind: 'INCOME', start: TODAY, end: TODAY }, TODAY).running,
    'Looking at today’s income'
  );
  assert.equal(
    toolActivityLabel('summarizeTransactions', { kind: 'EXPENSE', merchant: 'costco' }, TODAY).done,
    'Looked at spending at costco'
  );
  assert.equal(
    toolActivityLabel(
      'comparePeriods',
      { periodA: { start: '2026-03-01', end: '2026-03-31' }, periodB: { start: '2026-04-01', end: '2026-04-30', label: 'April' } },
      TODAY
    ).running,
    'Comparing March with April'
  );
  assert.equal(
    toolActivityLabel('searchTransactions', { merchant: 'Netflix', start: '2026-01-01', end: '2026-11-17' }, TODAY).done,
    'Searched transactions for “Netflix” · this year'
  );
  assert.equal(toolActivityLabel('budgetStatus', {}, TODAY).running, 'Checking this month’s budgets');
  assert.equal(toolActivityLabel('budgetStatus', { month: '2026-10' }, TODAY).done, 'Checked October budgets');
  assert.equal(toolActivityLabel('upcomingRecurring', { days: 14 }, TODAY).running, 'Looking for bills in the next 14 days');
  // Input still streaming in, or a tool this file does not know.
  assert.equal(toolActivityLabel('summarizeTransactions', undefined, TODAY).running, 'Looking at spending');
  assert.equal(toolActivityLabel('somethingNew', {}, TODAY).running, 'Looking that up');
});

const assistant = (...parts: unknown[]) => ({ role: 'assistant', parts });
const reply = (text: string) => ({ type: 'text', text });
const tool = (name: string, state: string, extra: Record<string, unknown> = {}) => ({
  type: `tool-${name}`,
  toolCallId: `call_${name}`,
  state,
  ...extra,
});

test('follow-ups depend on what the answer used', () => {
  const labels = (message: Parameters<typeof followUpsFor>[0]) => followUpsFor(message).map((f) => f.label);

  assert.deepEqual(
    labels(assistant(tool('summarizeTransactions', 'output-available', { input: { groupBy: 'category' } }), reply('Here it is.'))),
    ['Compare that with the month before', 'Show the biggest transactions']
  );
  assert.deepEqual(
    labels(assistant(tool('summarizeTransactions', 'output-available', { input: { groupBy: 'month' } }), reply('Here it is.'))),
    ['Break that down by category', 'Compare it with the period before']
  );
  // More results to page through.
  assert.ok(
    labels(
      assistant(tool('searchTransactions', 'output-available', { input: {}, output: { nextOffset: 20 } }), reply('The first 20.'))
    ).includes('Show more')
  );

  // After saving: "Log another" fills the composer instead of sending.
  const afterSave = followUpsFor(assistant(tool('createExpense', 'output-available'), reply('Saved.')));
  assert.equal(afterSave.length, 3);
  assert.deepEqual([afterSave[0].label, afterSave[0].send], ['Log another', false]);

  // Nothing competes with a card that is waiting, or with a question.
  assert.deepEqual(labels(assistant(tool('createExpense', 'approval-requested'))), []);
  assert.deepEqual(labels(assistant(reply('Which account did you pay with?'))), []);
  // Never under the user's own message, and never more than three.
  assert.deepEqual(labels({ role: 'user', parts: [reply('hi')] }), []);
  assert.deepEqual(labels(undefined), []);
  assert.ok(
    followUpsFor(
      assistant(
        tool('createIncome', 'output-available'),
        tool('accountBalances', 'output-available'),
        tool('budgetStatus', 'output-available'),
        reply('Done.')
      )
    ).length <= 3
  );
});

test('a new chat is titled from its first message until a title is generated', () => {
  const message = (parts: unknown[]): StoredMessage => ({ id: 'u1', role: 'user', parts });
  assert.equal(placeholderTitle(message([reply('  spent 20\n at   Costco ')])), 'spent 20 at Costco');
  assert.equal(placeholderTitle(message([reply('x'.repeat(200))])).length, 60);
  assert.equal(placeholderTitle(message([{ type: 'file', mediaType: 'image/jpeg', url: 'data:…' }])), 'Image');
  assert.equal(placeholderTitle(undefined), 'New chat');
});

test('only finished work is stored from a reply', () => {
  const stored = storableReply({
    id: 'msg-1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      tool('budgetStatus', 'output-available'),
      tool('summarizeTransactions', 'input-available'),
      tool('searchTransactions', 'input-streaming'),
      reply('You are on track'),
    ],
  } as never);
  assert.deepEqual(
    stored?.parts.map((p) => (p as { type: string }).type),
    ['step-start', 'tool-budgetStatus', 'text']
  );
  // Stopped before anything was written: nothing to keep.
  assert.equal(
    storableReply({ id: 'msg-2', role: 'assistant', parts: [{ type: 'step-start' }, reply('  ')] } as never),
    null
  );
});

test('the browser can add a user message but cannot rewrite the assistant', () => {
  const history: StoredMessage[] = [
    { id: 'u1', role: 'user', parts: [reply('hello')] },
    { id: 'a1', role: 'assistant', parts: [reply('Hi.')] },
  ];
  // A user message carrying tool parts keeps only its text and files.
  const added = mergeIncoming(history, {
    id: 'u2',
    role: 'user',
    parts: [reply('and now?'), tool('createExpense', 'output-available')],
  });
  assert.ok(added.ok);
  assert.deepEqual(added.messages[2].parts, [reply('and now?')]);
  assert.equal(added.fromPosition, 2);

  // An id that belongs to the assistant cannot be reused for a user message.
  assert.equal(mergeIncoming(history, { id: 'a1', role: 'user', parts: [reply('x')] }).ok, false);
  // A reply with no decision in it changes nothing, so it is refused.
  assert.equal(mergeIncoming(history, { id: 'a1', role: 'assistant', parts: [reply('Rewritten.')] }).ok, false);
  // Nor can an earlier reply be "continued" once the chat has moved on.
  assert.equal(
    mergeIncoming([...history, { id: 'u2', role: 'user', parts: [reply('next')] }], {
      id: 'a1',
      role: 'assistant',
      parts: [tool('createExpense', 'approval-responded', { approval: { id: 'x', approved: true } })],
    }).ok,
    false
  );
});
