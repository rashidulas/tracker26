/**
 * The assistant's write tools beyond "add one expense / one income"
 * (lib/assistant/actions.ts), driven end to end with a scripted model and the
 * fake database: the model calls a tool, the server builds the approval card,
 * the user approves, the change is saved through the shared modules.
 *
 * For every tool: what the card says, that nothing is saved before approval,
 * what is saved after it, and that approving twice saves once.
 *
 * Run: npm test (vitest)
 */
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readUIMessageStream, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import { ACTION_NAMES, ActionSaveError, previewAction, saveAction } from '../lib/assistant/actions';
import { runAssistant, type AssistantUIMessage } from '../lib/assistant/engine';
import { buildAppLink, LinkError } from '../lib/assistant/links';
import { decodePreview, type FieldEdits, type ProposalPreview } from '../lib/assistant/preview';
import { proposalNoun, WRITE_TOOL_PARTS } from '../lib/assistant/toolLabels';
import { INVALID_PROPOSAL_PREFIX, WRITE_TOOL_NAMES, type ActionResult } from '../lib/assistant/tools';
import { parseDay, toDayString } from '../lib/dates';
import { seedAssistantData, TODAY } from './support/assistantSeed';
import type { FakeDb } from './support/fakeDb';

type Prompt = Parameters<MockLanguageModelV4['doStream']>[0]['prompt'];
type Chunk = Record<string, unknown>;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const text = (t: string): Chunk[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: t },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
];

const toolCall = (toolCallId: string, toolName: string, input: unknown): Chunk[] => [
  { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
];

let db: FakeDb;
let ids: ReturnType<typeof seedAssistantData>['ids'];
let prompts: Prompt[];
let script: (prompt: Prompt) => Chunk[];

const model = new MockLanguageModelV4({
  doStream: async ({ prompt }) => {
    prompts.push(prompt);
    return { stream: simulateReadableStream({ chunks: script(prompt) as never[] }) };
  },
});

beforeEach(() => {
  const seeded = seedAssistantData();
  db = seeded.db;
  ids = seeded.ids;
  prompts = [];
});

const deps = () => ({
  db: db as never,
  today: TODAY,
  timeZone: 'America/New_York',
  currency: 'USD',
  transactionDeps: { db: db as never, revalidate: () => {} },
});

/** One request, as the client sends it: a fresh JSON copy of the conversation. */
async function turn(sent: AssistantUIMessage[], proposalEdits?: Record<string, { fields: FieldEdits }>) {
  const messages: AssistantUIMessage[] = structuredClone(sent);
  const result = await runAssistant({
    messages,
    model,
    provider: 'openai',
    approvalSecret: 'test-secret-test-secret-test-secret',
    deps: deps(),
    proposalEdits,
  });
  assert.ok(result.ok, result.ok ? '' : result.error);
  const last = messages[messages.length - 1];
  let message: AssistantUIMessage | undefined;
  for await (const m of readUIMessageStream<AssistantUIMessage>({
    stream: result.stream,
    message: last.role === 'assistant' ? last : undefined,
    terminateOnError: false,
  })) {
    message = m;
  }
  assert.ok(message, 'stream produced a message');
  return last.role === 'assistant' ? [...messages.slice(0, -1), message] : [...messages, message];
}

let nextId = 0;
const user = (t: string): AssistantUIMessage => ({ id: `u${++nextId}`, role: 'user', parts: [{ type: 'text', text: t }] });

type AnyPart = {
  type: string;
  state: string;
  toolCallId: string;
  approval?: { requestReason?: string; isAutomatic?: boolean; reason?: string };
  output?: ActionResult;
  errorText?: string;
};

const toolPart = (messages: AssistantUIMessage[], name: string) => {
  const part = messages[messages.length - 1].parts.find((p) => p.type === `tool-${name}`);
  assert.ok(part, `the reply has a ${name} part`);
  return part as unknown as AnyPart;
};

/** What useChat's addToolApprovalResponse does to the message. */
function respond(messages: AssistantUIMessage[], approved: boolean) {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.map((p) =>
      'state' in p && p.state === 'approval-requested' && !p.approval.isAutomatic
        ? { ...p, state: 'approval-responded' as const, approval: { ...p.approval, approved } }
        : p
    ),
  })) as AssistantUIMessage[];
}

/** Everything in the database, to compare before and after. */
const snapshot = () => JSON.stringify(db.data);

let callNo = 0;

/** The model proposes; returns the card the user would see. Nothing may be saved yet. */
async function propose(tool: string, input: unknown) {
  const before = snapshot();
  const callId = `call_${tool}_${++callNo}`;
  script = () => toolCall(callId, tool, input);
  const messages = await turn([user(`please ${tool}`)]);
  const part = toolPart(messages, tool);
  assert.equal(part.state, 'approval-requested', part.approval?.reason ?? part.errorText ?? part.state);
  const preview = decodePreview(part.approval!.requestReason);
  assert.ok(preview, 'the approval request carries a preview');
  assert.equal(snapshot(), before, 'nothing is saved before approval');
  return { messages, preview, callId };
}

/** The user approves (optionally after editing the card); returns the tool's result. */
async function approve(
  proposal: { messages: AssistantUIMessage[]; callId: string },
  tool: string,
  fields?: FieldEdits
) {
  script = () => text('Done.');
  const approved = respond(proposal.messages, true);
  const edits = fields ? { [proposal.callId]: { fields } } : undefined;
  const after = await turn(approved, edits);
  const part = toolPart(after, tool);
  assert.equal(part.state, 'output-available', part.errorText ?? part.approval?.reason ?? part.state);
  assert.equal(part.output!.status, 'saved');
  assert.equal(part.output!.alreadySaved, false);

  // A retry or a double tap replays the same approval: nothing more is written.
  const saved = snapshot();
  const replay = await turn(approved, edits);
  const again = toolPart(replay, tool);
  assert.equal(again.state, 'output-available', again.errorText ?? again.approval?.reason ?? again.state);
  assert.equal(again.output!.alreadySaved, true, 'the second approval is a replay');
  assert.equal(again.output!.summary, part.output!.summary);
  assert.equal(snapshot(), saved, 'approving twice saves once');
  assert.equal(db.data.idempotencyKey.filter((k) => k.key === `assistant:${proposal.callId}`).length, 1);
  return part.output!;
}

/** Propose, check the card, approve, approve again. */
async function roundTrip(tool: string, input: unknown, fields?: FieldEdits) {
  const proposal = await propose(tool, input);
  const output = await approve(proposal, tool, fields);
  return { preview: proposal.preview, output };
}

/** A proposal the server sends straight back to the model; the user never sees a card. */
async function rejected(tool: string, input: unknown) {
  const before = snapshot();
  let calls = 0;
  let seen = '';
  script = (prompt) => {
    calls += 1;
    if (calls === 1) return toolCall(`call_bad_${++callNo}`, tool, input);
    seen = JSON.stringify(prompt);
    return text('Let me fix that.');
  };
  const messages = await turn([user(`please ${tool}`)]);
  const part = toolPart(messages, tool);
  assert.equal(part.state, 'output-denied');
  assert.equal(part.approval!.isAutomatic, true);
  assert.ok(seen.includes(INVALID_PROPOSAL_PREFIX), 'the model is told why');
  assert.equal(snapshot(), before, 'nothing saved');
  return seen;
}

const tx = (merchant: string, day: string) => {
  const row = db.data.transaction.find((t) => t.merchantOrSource === merchant && toDayString(t.date) === day);
  assert.ok(row, `seeded ${merchant} on ${day}`);
  return row;
};
const byId = (id: string) => db.data.transaction.find((t) => t.id === id);
const field = (preview: ProposalPreview, item: number, label: string) => {
  const found = preview.items[item].fields.find((f) => f.label === label);
  assert.ok(found, `item ${item} has a "${label}" field`);
  return found;
};

// ==================== TRANSACTIONS: ADD ====================

test('logTransactions: "coffee 4.50, lunch 12, parking 6" is one card, saved together', async () => {
  const before = db.data.transaction.length;
  const { preview, output } = await roundTrip('logTransactions', {
    items: [
      { kind: 'EXPENSE', amount: 4.5, date: TODAY, categoryId: ids.dining, accountId: ids.chase, merchant: 'Coffee' },
      { kind: 'EXPENSE', amount: 12, date: TODAY, categoryId: ids.dining, accountId: ids.chase, merchant: 'Lunch' },
      { kind: 'EXPENSE', amount: 6, date: TODAY, categoryId: ids.household, accountId: ids.chase, merchant: 'Parking' },
    ],
  });
  assert.equal(preview.heading, 'Add 3 transactions');
  assert.equal(preview.count, 3);
  assert.equal(preview.destructive, false);
  assert.deepEqual(
    preview.items.map((i) => i.title),
    ['Expense $4.50 at Coffee', 'Expense $12.00 at Lunch', 'Expense $6.00 at Parking']
  );
  // Each row can be corrected on the card.
  assert.deepEqual(field(preview, 1, 'Category').edit, { key: 'items.1.categoryId', control: 'expenseCategory', value: ids.dining });
  assert.equal(field(preview, 2, 'Paid from').value, 'Chase Card');

  const added = db.data.transaction.slice(before);
  assert.deepEqual(added.map((t) => t.amount), [4.5, 12, 6]);
  assert.ok(added.every((t) => t.kind === 'EXPENSE' && t.accountId === ids.chase && t.merchantId));

  // The knock-on effect comes from the budget read: Dining had 75 spent of 50.
  const dining = output.effects.find((e) => e.type === 'budget' && e.category === 'Dining');
  assert.ok(dining && dining.type === 'budget');
  assert.equal(dining.spent, 91.5);
  assert.equal(dining.usedPct, 183);
  assert.equal(dining.status, 'over');
});

test('logTransactions: an expense, its category split and a friend share are one write', async () => {
  const { preview } = await roundTrip('logTransactions', {
    items: [
      {
        kind: 'EXPENSE',
        amount: 120,
        date: TODAY,
        accountId: ids.discover,
        merchant: 'Target',
        categorySplits: [
          { categoryId: ids.groceries, amount: 80 },
          { categoryId: ids.household, amount: 40 },
        ],
        friendShares: [{ friendId: ids.alex, amount: 30 }],
      },
    ],
  });
  assert.equal(preview.heading, 'Add expense');
  assert.equal(field(preview, 0, 'Category').value, 'Groceries $80.00 + Household $40.00');
  assert.equal(field(preview, 0, 'Alex owes').value, '$30.00');
  assert.equal(field(preview, 0, 'Your share').value, '$90.00');
  // The parts have to keep adding up, so the total is not editable here.
  assert.equal(field(preview, 0, 'Amount').edit, undefined);

  const saved = tx('Target', TODAY);
  assert.equal(saved.sharedAmount, 30);
  assert.deepEqual(saved.splitItems.map((s: { amount: number }) => s.amount), [80, 40]);
  const iou = db.data.friendEntry.find((e) => e.transactionId === saved.id);
  assert.deepEqual([iou?.friendId, iou?.amount, iou?.type], [ids.alex, 30, 'THEY_OWE_ME']);
});

test('logTransactions: income split across two accounts', async () => {
  const { preview } = await roundTrip('logTransactions', {
    items: [
      {
        kind: 'INCOME',
        amount: 1500,
        date: TODAY,
        categoryId: ids.salary,
        merchant: 'Acme Corp',
        accountSplits: [
          { accountId: ids.checking, amount: 1200 },
          { accountId: ids.savings, amount: 300 },
        ],
      },
    ],
  });
  assert.equal(preview.items[0].title, 'Income $1,500.00 from Acme Corp');
  assert.equal(field(preview, 0, 'Into').value, 'Checking $1,200.00 + Savings $300.00');
  const saved = tx('Acme Corp', TODAY);
  assert.deepEqual(
    saved.accountSplits.map((s: { accountId: string; amount: number }) => [s.accountId, s.amount]),
    [
      [ids.checking, 1200],
      [ids.savings, 300],
    ]
  );
});

test('a multi-write proposal is all or nothing', async () => {
  const before = snapshot();
  const items = [
    { kind: 'EXPENSE' as const, amount: 4.5, date: TODAY, categoryId: ids.dining, accountId: ids.chase, merchant: 'Brand new cafe' },
    { kind: 'EXPENSE' as const, amount: 12, date: TODAY, categoryId: ids.dining, accountId: ids.chase, merchant: 'Lunch spot' },
    // The friend does not exist: this one fails after the first two were written.
    {
      kind: 'EXPENSE' as const,
      amount: 6,
      date: TODAY,
      categoryId: ids.household,
      accountId: ids.chase,
      friendShares: [{ friendId: 'f'.repeat(24), amount: 3 }],
    },
  ];
  await assert.rejects(
    saveAction('logTransactions', { items }, 'call_atomic', { tx: deps().transactionDeps, today: TODAY }),
    (error: unknown) => error instanceof ActionSaveError && /Friend not found/.test(error.message)
  );
  // No expense, no new merchant, no record that the call was handled.
  assert.equal(snapshot(), before);

  // Through the assistant the same proposal never reaches the user.
  const told = await rejected('logTransactions', { items });
  assert.match(told, /Friend not found/);

  // And one that was valid when proposed but is not when approved saves nothing either.
  const proposal = await propose('logTransactions', { items: items.slice(0, 2) });
  db.data.account = db.data.account.filter((a) => a.id !== ids.chase);
  const stale = snapshot();
  script = () => text('That could not be saved.');
  const after = await turn(respond(proposal.messages, true));
  assert.equal(toolPart(after, 'logTransactions').state, 'output-denied');
  assert.equal(snapshot(), stale);
});

// ==================== TRANSACTIONS: CHANGE ====================

test('changeTransactions edit: the card shows old and new values, and the row changes once', async () => {
  const chipotle = tx('Chipotle', '2026-03-25');
  const { preview, output } = await roundTrip('changeTransactions', {
    action: 'edit',
    transactionIds: [chipotle.id],
    changes: { amount: 30, categoryId: ids.groceries, date: '2026-03-26' },
  });
  assert.equal(preview.heading, 'Edit expense');
  assert.equal(preview.count, 1);
  assert.equal(preview.items[0].title, 'Expense $25.50 at Chipotle');
  assert.deepEqual(
    [field(preview, 0, 'Amount').was, field(preview, 0, 'Amount').value],
    ['$25.50', '$30.00']
  );
  assert.deepEqual([field(preview, 0, 'Category').was, field(preview, 0, 'Category').value], ['Dining', 'Groceries']);
  assert.deepEqual([field(preview, 0, 'Date').was, field(preview, 0, 'Date').value], ['2026-03-25', '2026-03-26']);
  // Unchanged values are shown without a "before".
  assert.equal(field(preview, 0, 'Paid from').was, undefined);

  const row = byId(chipotle.id)!;
  assert.deepEqual([row.amount, row.categoryId, toDayString(row.date)], [30, ids.groceries, '2026-03-26']);
  // What was not mentioned is kept.
  assert.deepEqual([row.accountId, row.merchantOrSource], [ids.discover, 'Chipotle']);
  assert.match(row.notes, /IGNORE ALL PREVIOUS/);
  assert.match(output.summary, /Amount \$25\.50 → \$30\.00/);
});

test('changeTransactions edit: values changed on the card are what gets saved', async () => {
  const cafe = tx('Cafe', '2026-04-30');
  const proposal = await propose('changeTransactions', {
    action: 'edit',
    transactionIds: [cafe.id],
    changes: { amount: 14 },
  });
  const output = await approve(proposal, 'changeTransactions', {
    'changes.amount': 15.25,
    'changes.accountId': ids.discover,
  });
  assert.equal(output.editedByUser, true);
  const row = byId(cafe.id)!;
  assert.deepEqual([row.amount, row.accountId], [15.25, ids.discover]);
  assert.equal(field(output.preview, 0, 'Amount').value, '$15.25');
});

test('changeTransactions edit: can split an existing expense across categories', async () => {
  const costco = tx('Costco', '2026-05-01');
  await roundTrip('changeTransactions', {
    action: 'edit',
    transactionIds: [costco.id],
    changes: {
      categorySplits: [
        { categoryId: ids.groceries, amount: 60 },
        { categoryId: ids.household, amount: 39 },
      ],
    },
  });
  const row = byId(costco.id)!;
  assert.equal(row.categoryId, null);
  assert.deepEqual(row.splitItems.map((s: { amount: number }) => s.amount), [60, 39]);
});

test('changeTransactions delete: lists every record, counts them, and deletes once', async () => {
  const pizza = tx('Pizza place', '2026-11-14');
  const steak = tx('Steakhouse', '2026-11-10');
  // Alex owes 25 of the pizza.
  db.seed('friendEntry', { friendId: ids.alex, transactionId: pizza.id, date: parseDay('2026-11-14'), amount: 25, type: 'THEY_OWE_ME' });
  const total = db.data.transaction.length;

  const { preview, output } = await roundTrip('changeTransactions', {
    action: 'delete',
    transactionIds: [pizza.id, steak.id],
  });
  assert.equal(preview.heading, 'Delete 2 transactions');
  assert.equal(preview.destructive, true);
  assert.equal(preview.count, 2);
  assert.deepEqual(preview.items.map((i) => [i.tone, i.title]), [
    ['remove', 'Expense $40.00 at Pizza place'],
    ['remove', 'Expense $60.00 at Steakhouse'],
  ]);
  assert.match(preview.warning ?? '', /Also removes 1 friend IOU linked to them\. This cannot be undone\./);

  assert.equal(db.data.transaction.length, total - 2);
  assert.equal(byId(pizza.id), undefined);
  assert.equal(db.data.friendEntry.some((e) => e.transactionId === pizza.id), false);
  // Dining was 75 of 50; with both gone nothing is left in it.
  const dining = output.effects.find((e) => e.type === 'budget' && e.category === 'Dining');
  assert.ok(dining && dining.type === 'budget');
  assert.equal(dining.spent, 0);
});

test('changeTransactions: an id that does not exist is sent back to the model', async () => {
  const told = await rejected('changeTransactions', { action: 'delete', transactionIds: ['a'.repeat(24)] });
  assert.match(told, /No transaction has the id/);
});

test('changeTransactions duplicate: copies onto a day', async () => {
  const netflix = tx('Netflix', '2026-10-20');
  const before = db.data.transaction.length;
  const { preview } = await roundTrip('changeTransactions', { action: 'duplicate', transactionIds: [netflix.id] });
  assert.equal(preview.heading, 'Duplicate 1 transaction');
  assert.equal(preview.items[0].title, 'Expense $15.49 at Netflix');
  assert.equal(field(preview, 0, 'Date').value, TODAY);
  const copies = db.data.transaction.slice(before);
  assert.equal(copies.length, 1);
  assert.deepEqual(
    [copies[0].amount, copies[0].categoryId, copies[0].accountId, toDayString(copies[0].date)],
    [15.49, ids.subscriptions, ids.discover, TODAY]
  );
});

test('changeTransactions recategorize: a bulk change says what moves and what is left alone', async () => {
  const hardware = tx('Hardware store', '2026-11-12');
  const cafe = tx('Cafe', '2026-04-30');
  const payment = tx('Payment', '2026-04-12');
  const { preview } = await roundTrip('changeTransactions', {
    action: 'recategorize',
    transactionIds: [hardware.id, cafe.id, payment.id],
    categoryId: ids.groceries,
  });
  assert.equal(preview.heading, 'Move 2 transactions to Groceries');
  assert.equal(preview.destructive, true);
  assert.equal(preview.count, 2);
  assert.deepEqual(
    preview.items.map((i) => [i.fields[0].was, i.fields[0].value]),
    [
      ['Household', 'Groceries'],
      ['Dining', 'Groceries'],
    ]
  );
  assert.match(preview.warning ?? '', /1 transaction left as it is/);
  assert.equal(byId(hardware.id)!.categoryId, ids.groceries);
  assert.equal(byId(cafe.id)!.categoryId, ids.groceries);
  assert.equal(byId(payment.id)!.kind, 'TRANSFER');
});

// ==================== TRANSFERS ====================

test('moveMoney cardPayment: a tagged transfer, with what is still owed afterwards', async () => {
  const before = db.data.transaction.length;
  const { preview, output } = await roundTrip('moveMoney', {
    action: 'cardPayment',
    fromAccountId: ids.checking,
    toAccountId: ids.discover,
    amount: 50,
    date: TODAY,
  });
  assert.equal(preview.heading, 'Card payment');
  assert.equal(preview.items[0].title, 'Card payment $50.00');
  assert.equal(field(preview, 0, 'From').value, 'Checking');
  assert.equal(field(preview, 0, 'To').value, 'Discover');

  const [row] = db.data.transaction.slice(before);
  assert.equal(db.data.transaction.length, before + 1);
  assert.deepEqual([row.kind, row.amount, row.accountId, row.toAccountId], ['TRANSFER', 50, ids.checking, ids.discover]);
  // Same tag and category as the app's own payment form.
  assert.deepEqual(row.tags, ['payment']);
  assert.equal(db.data.category.find((c) => c.id === row.categoryId)?.name, 'Payment');

  const card = output.effects.find((e) => e.type === 'account' && e.account === 'Discover');
  assert.ok(card && card.type === 'account');
  // 372.17 charged, 300 paid in April, 50 now.
  assert.equal(card.owed, 22.17);
});

test('moveMoney: loan payments and plain transfers; a card payment needs a card', async () => {
  const loan = await roundTrip('moveMoney', {
    action: 'loanPayment',
    fromAccountId: ids.checking,
    toAccountId: ids.loan,
    amount: 250,
    date: TODAY,
  });
  assert.equal(loan.preview.heading, 'Loan payment');
  assert.deepEqual(db.data.transaction[db.data.transaction.length - 1].tags, ['debt-payment']);

  const plain = await roundTrip('moveMoney', {
    action: 'transfer',
    fromAccountId: ids.checking,
    toAccountId: ids.savings,
    amount: 100,
    date: TODAY,
  });
  assert.equal(plain.preview.heading, 'Transfer');
  assert.deepEqual(db.data.transaction[db.data.transaction.length - 1].tags, []);

  const told = await rejected('moveMoney', {
    action: 'cardPayment',
    fromAccountId: ids.checking,
    toAccountId: ids.savings,
    amount: 10,
    date: TODAY,
  });
  assert.match(told, /Savings.*is not a credit card/);
});

// ==================== FRIENDS ====================

test('updateFriends addFriend, then iPaid and theyPaid', async () => {
  const added = await roundTrip('updateFriends', { action: 'addFriend', name: 'Jordan' });
  assert.equal(added.preview.heading, 'Add friend');
  const jordan = db.data.friend.find((f) => f.name === 'Jordan');
  assert.ok(jordan);
  assert.equal(db.data.friend.filter((f) => f.name === 'Jordan').length, 1);
  // The id is in the summary, so the model can use it in the next step.
  assert.ok(added.output.summary.includes(jordan.id));

  const lent = await roundTrip('updateFriends', {
    action: 'iPaid',
    friendId: jordan.id,
    amount: 40,
    description: 'Dinner',
  });
  assert.equal(lent.preview.items[0].title, 'Jordan owes you $40.00');
  assert.deepEqual(
    [field(lent.preview, 0, 'Balance after').was, field(lent.preview, 0, 'Balance after').value],
    ['Settled up with Jordan', 'Jordan owes you $40.00']
  );
  const owed = db.data.friendEntry.find((e) => e.friendId === jordan.id);
  assert.deepEqual([owed?.type, owed?.amount, owed?.description, owed?.accountId], ['THEY_OWE_ME', 40, 'Dinner', null]);

  const borrowed = await roundTrip('updateFriends', { action: 'theyPaid', friendId: ids.sam, amount: 10 });
  assert.equal(borrowed.preview.items[0].title, 'You owe Sam $10.00');
  const sam = borrowed.output.effects.find((e) => e.type === 'friend');
  assert.deepEqual(sam, { type: 'friend', friend: 'Sam', balance: -25 });

  const told = await rejected('updateFriends', { action: 'addFriend', name: 'jordan ' });
  assert.match(told, /already a friend called/);
});

test('updateFriends splitExpense: friends owe part of an expense that already exists', async () => {
  const steak = tx('Steakhouse', '2026-11-10');
  const { preview, output } = await roundTrip('updateFriends', {
    action: 'splitExpense',
    transactionId: steak.id,
    shares: [
      { friendId: ids.alex, amount: 20 },
      { friendId: ids.sam, amount: 15 },
    ],
  });
  assert.equal(field(preview, 0, 'Alex owes').value, '$20.00');
  assert.deepEqual([field(preview, 0, 'Your share').was, field(preview, 0, 'Your share').value], ['$60.00', '$25.00']);
  assert.equal(byId(steak.id)!.sharedAmount, 35);
  assert.equal(db.data.friendEntry.filter((e) => e.transactionId === steak.id).length, 2);
  // Dining spending is now only the user's share: 75 - 35.
  const dining = output.effects.find((e) => e.type === 'budget');
  assert.ok(dining && dining.type === 'budget');
  assert.equal(dining.spent, 40);
});

test('updateFriends settleUp: the server works out the balance and the direction', async () => {
  const { preview, output } = await roundTrip('updateFriends', {
    action: 'settleUp',
    friendId: ids.alex,
    accountId: ids.checking,
  });
  // Alex owed 50 and has paid back 20.
  assert.equal(preview.heading, 'Settle up with Alex');
  assert.equal(preview.items[0].title, 'Alex pays you back $30.00');
  assert.equal(field(preview, 0, 'Received into').value, 'Checking');
  const entry = db.data.friendEntry[db.data.friendEntry.length - 1];
  assert.deepEqual([entry.type, entry.amount, entry.accountId], ['THEY_PAID_ME', 30, ids.checking]);
  assert.deepEqual(output.effects.find((e) => e.type === 'friend'), { type: 'friend', friend: 'Alex', balance: 0 });

  // The other way round: the user owes Sam 15.
  const sam = await roundTrip('updateFriends', { action: 'settleUp', friendId: ids.sam });
  assert.equal(sam.preview.items[0].title, 'You pay Sam back $15.00');
  assert.equal(db.data.friendEntry[db.data.friendEntry.length - 1].type, 'I_PAID_THEM');

  const told = await rejected('updateFriends', { action: 'settleUp', friendId: ids.alex });
  assert.match(told, /already settled up/);
});

// ==================== GOALS ====================

test('updateGoals create and contribute (a transfer, or money set aside)', async () => {
  const created = await roundTrip('updateGoals', {
    action: 'create',
    name: 'New laptop',
    targetAmount: 1800,
    dueDate: '2027-06-01',
  });
  assert.equal(created.preview.heading, 'Create goal');
  const laptop = db.data.goal.filter((g) => g.name === 'New laptop');
  assert.equal(laptop.length, 1);
  assert.deepEqual([laptop[0].targetAmount, toDayString(laptop[0].dueDate)], [1800, '2027-06-01']);

  // Vacation is kept in Savings; money from Checking has to move there.
  const vacation = db.data.goal.find((g) => g.name === 'Vacation')!;
  const transfers = db.data.transaction.filter((t) => t.kind === 'TRANSFER').length;
  const moved = await roundTrip('updateGoals', {
    action: 'contribute',
    goalId: vacation.id,
    amount: 100,
    fromAccountId: ids.checking,
  });
  assert.equal(field(moved.preview, 0, 'How').value, 'Transfer from Checking to Savings');
  assert.equal(db.data.transaction.filter((t) => t.kind === 'TRANSFER').length, transfers + 1);
  const contribution = db.data.goalContribution.find((c) => c.goalId === vacation.id);
  assert.ok(contribution?.transactionId);
  assert.deepEqual(moved.output.effects.find((e) => e.type === 'goal'), {
    type: 'goal',
    goal: 'Vacation',
    target: 300,
    saved: 100,
    remaining: 200,
    progressPct: 33.3,
  });

  // The emergency fund has no account of its own: nothing moves.
  const fund = db.data.goal.find((g) => g.name === 'Emergency fund')!;
  const earmark = await roundTrip('updateGoals', {
    action: 'contribute',
    goalId: fund.id,
    amount: 50,
    fromAccountId: ids.savings,
  });
  assert.equal(field(earmark.preview, 0, 'How').value, 'Set aside in Savings (no money moves)');
  assert.equal(db.data.transaction.filter((t) => t.kind === 'TRANSFER').length, transfers + 1);
});

// ==================== BUDGETS ====================

test('updateBudgets set: changes a budget and reports where it stands', async () => {
  const { preview, output } = await roundTrip('updateBudgets', {
    action: 'set',
    categoryId: ids.dining,
    amount: 100,
  });
  assert.equal(preview.heading, 'Change budget');
  assert.equal(preview.items[0].title, 'Dining · November 2026');
  assert.deepEqual([field(preview, 0, 'Budget').was, field(preview, 0, 'Budget').value], ['$50.00', '$100.00']);
  const budgets = db.data.budget.filter((b) => b.categoryId === ids.dining);
  assert.deepEqual(budgets.map((b) => b.amount), [100]);
  const dining = output.effects.find((e) => e.type === 'budget');
  assert.ok(dining && dining.type === 'budget');
  assert.deepEqual([dining.budget, dining.spent, dining.usedPct, dining.remaining], [100, 75, 75, 25]);

  // A new budget, with the amount corrected on the card.
  const proposal = await propose('updateBudgets', { action: 'set', categoryId: ids.household, amount: 80 });
  assert.equal(proposal.preview.heading, 'Set budget');
  await approve(proposal, 'updateBudgets', { amount: 90 });
  assert.equal(db.data.budget.find((b) => b.categoryId === ids.household)?.amount, 90);

  // 0 removes it.
  const removed = await roundTrip('updateBudgets', { action: 'set', categoryId: ids.household, amount: 0 });
  assert.equal(removed.preview.heading, 'Remove budget');
  assert.equal(db.data.budget.some((b) => b.categoryId === ids.household), false);

  const told = await rejected('updateBudgets', { action: 'set', categoryId: ids.salary, amount: 10 });
  assert.match(told, /Salary.*is an income category/);
});

test('updateBudgets copyLastMonth: copies only what the month does not have yet', async () => {
  const { preview } = await roundTrip('updateBudgets', { action: 'copyLastMonth', month: '2026-12' });
  assert.equal(preview.heading, 'Copy 2 budgets into December 2026');
  assert.equal(preview.count, 2);
  assert.deepEqual(preview.items.map((i) => i.title).sort(), ['Dining $50.00', 'Groceries $200.00']);
  const december = db.data.budget.filter((b) => toDayString(b.month) === '2026-12-01');
  assert.equal(december.length, 2);
  assert.equal(december.find((b) => b.categoryId === ids.groceries)?.rolloverEnabled, true);

  const told = await rejected('updateBudgets', { action: 'copyLastMonth', month: '2026-12' });
  assert.match(told, /Nothing to copy into December 2026/);
});

// ==================== RECURRING ====================

test('updateRecurring create, pause, resume and skip', async () => {
  const created = await roundTrip('updateRecurring', {
    action: 'create',
    kind: 'EXPENSE',
    amount: 1200,
    frequency: 'MONTHLY',
    startDate: '2026-12-01',
    categoryId: ids.household,
    accountId: ids.checking,
    merchant: 'Landlord',
    name: 'Rent',
  });
  assert.equal(created.preview.heading, 'Create recurring entry');
  assert.equal(field(created.preview, 0, 'First due').value, '2026-12-01');
  assert.equal(field(created.preview, 0, 'Records').value, 'When you confirm each one');
  const rent = db.data.recurringTransaction.filter((r) => r.name === 'Rent');
  assert.equal(rent.length, 1);
  assert.deepEqual([rent[0].amount, rent[0].frequency, toDayString(rent[0].nextDueDate)], [1200, 'MONTHLY', '2026-12-01']);

  const netflix = db.data.recurringTransaction.find((r) => r.name === 'Netflix')!;
  const paused = await roundTrip('updateRecurring', { action: 'pause', recurringId: netflix.id });
  assert.deepEqual([field(paused.preview, 0, 'Status').was, field(paused.preview, 0, 'Status').value], ['Active', 'Paused']);
  assert.equal(db.data.recurringTransaction.find((r) => r.id === netflix.id)!.active, false);
  assert.match(await rejected('updateRecurring', { action: 'pause', recurringId: netflix.id }), /already paused/);

  await roundTrip('updateRecurring', { action: 'resume', recurringId: netflix.id });
  assert.equal(db.data.recurringTransaction.find((r) => r.id === netflix.id)!.active, true);

  const transactions = db.data.transaction.length;
  const skipped = await roundTrip('updateRecurring', { action: 'skip', recurringId: netflix.id });
  assert.equal(skipped.preview.heading, 'Skip one occurrence');
  assert.deepEqual(
    [field(skipped.preview, 0, 'Next due').was, field(skipped.preview, 0, 'Next due').value],
    ['2026-11-20', '2026-12-20']
  );
  assert.equal(toDayString(db.data.recurringTransaction.find((r) => r.id === netflix.id)!.nextDueDate), '2026-12-20');
  // Skipped exactly one occurrence, and nothing was posted for it.
  assert.equal(db.data.recurringPosting.filter((p) => p.recurringId === netflix.id && p.status === 'SKIPPED').length, 1);
  assert.equal(db.data.transaction.length, transactions);
});

// ==================== CATEGORIES AND MERCHANTS ====================

test('updateCategories createCategory and createSubcategory', async () => {
  const created = await roundTrip('updateCategories', {
    action: 'createCategory',
    name: 'Pets',
    type: 'EXPENSE',
    icon: '🐶',
    subcategories: ['Food', 'Vet', 'food'],
  });
  assert.equal(created.preview.heading, 'Create expense category');
  assert.equal(created.preview.count, 3);
  const pets = db.data.category.filter((c) => c.name === 'Pets');
  assert.equal(pets.length, 1);
  assert.deepEqual(
    db.data.subcategory.filter((s) => s.categoryId === pets[0].id).map((s) => s.name).sort(),
    ['Food', 'Vet']
  );
  assert.match(await rejected('updateCategories', { action: 'createCategory', name: 'Pets', type: 'EXPENSE' }), /already exists/);

  const sub = await roundTrip('updateCategories', { action: 'createSubcategory', categoryId: ids.groceries, name: 'Snacks' });
  assert.equal(sub.preview.items[0].title, 'Groceries › Snacks');
  assert.equal(db.data.subcategory.filter((s) => s.categoryId === ids.groceries && s.name === 'Snacks').length, 1);
  assert.match(
    await rejected('updateCategories', { action: 'createSubcategory', categoryId: ids.groceries, name: 'produce' }),
    /already has a subcategory called/
  );
});

test('updateCategories setMerchantDefault: optionally moves past transactions, and lists them', async () => {
  // Without applyToPast only the default changes.
  const only = await roundTrip('updateCategories', {
    action: 'setMerchantDefault',
    merchant: 'Gym',
    categoryId: ids.household,
  });
  assert.equal(only.preview.heading, 'Set default for Gym');
  assert.equal(only.preview.count, 1);
  const gym = db.data.merchant.find((m) => m.normalizedName === 'gym')!;
  assert.equal(gym.defaultCategoryId, ids.household);

  // The three Gym expenses are linked to the merchant the way the app links them.
  for (const t of db.data.transaction.filter((row) => row.merchantOrSource === 'Gym')) t.merchantId = gym.id;
  const { preview } = await roundTrip('updateCategories', {
    action: 'setMerchantDefault',
    merchant: 'gym',
    categoryId: ids.dining,
    applyToPast: true,
  });
  assert.equal(preview.destructive, true);
  assert.equal(preview.count, 4);
  assert.equal(preview.items.length, 4);
  assert.deepEqual([preview.items[1].fields[0].was, preview.items[1].fields[0].value], ['Subscriptions', 'Dining']);
  assert.match(preview.warning ?? '', /Also moves 3 past expenses from Gym to Dining/);
  assert.ok(db.data.transaction.filter((t) => t.merchantOrSource === 'Gym').every((t) => t.categoryId === ids.dining));
});

// ==================== NAVIGATION ====================

test('linkToPage runs without approval and only uses filters the page supports', async () => {
  let call = 0;
  let seen = '';
  script = (prompt) => {
    call += 1;
    if (call === 1) {
      return toolCall('call_link', 'linkToPage', {
        page: 'expenses',
        from: '2026-11-01',
        to: '2026-11-17',
        categoryId: ids.dining,
      });
    }
    seen = JSON.stringify(prompt);
    return text('[Open these 2 expenses](/transactions/expenses?from=2026-11-01&to=2026-11-17)');
  };
  const messages = await turn([user('show me dining this month')]);
  const part = toolPart(messages, 'linkToPage') as unknown as { state: string; output: { href: string; page: string } };
  assert.equal(part.state, 'output-available');
  assert.equal(part.output.href, `/transactions/expenses?from=2026-11-01&to=2026-11-17&category=${ids.dining}`);
  assert.ok(seen.includes(part.output.href));

  assert.deepEqual(buildAppLink({ page: 'budgets', month: '2026-10' }), {
    href: '/plan/budgets?month=2026-10',
    page: 'Budgets',
    ignored: [],
  });
  assert.equal(buildAppLink({ page: 'transfers', month: '2026-04' }).href, '/transactions/transfers?month=2026-04');
  assert.equal(buildAppLink({ page: 'insights', range: '90d' }).href, '/insights?range=90d');
  assert.equal(buildAppLink({ page: 'income', month: '2026-11' }).href, '/transactions/income?month=2026-11');
  // A date range already narrows the list; the month is dropped rather than hiding part of it.
  assert.equal(
    buildAppLink({ page: 'expenses', from: '2026-10-20', to: '2026-11-05', month: '2026-11' }).href,
    '/transactions/expenses?from=2026-10-20&to=2026-11-05'
  );
  // Filters a page cannot apply are reported, not silently added to the URL.
  assert.deepEqual(buildAppLink({ page: 'friends', from: '2026-11-01', categoryId: ids.dining }), {
    href: '/friends',
    page: 'Friends',
    ignored: ['date range', 'category'],
  });
  assert.equal(buildAppLink({ page: 'dashboard' }).href, '/');
  assert.throws(() => buildAppLink({ page: 'expenses', from: '2026-02-30' }), LinkError);
});

// ==================== SAFETY ====================

test('a card edit can only change what the card offers, and is validated again', async () => {
  const chipotle = tx('Chipotle', '2026-03-25');
  const input = { action: 'edit', transactionIds: [chipotle.id], changes: { amount: 30 } };

  // The browser cannot redirect the change to another record.
  const forged = await previewAction(db as never, 'changeTransactions', input, { today: TODAY }, {
    'transactionIds.0': tx('Cafe', '2026-04-30').id,
  });
  assert.deepEqual(forged, { ok: false, problem: '"transactionIds.0" cannot be changed on this card' });
  // Nor send a value of the wrong kind, or an id that is not in the database.
  const wrongType = await previewAction(db as never, 'changeTransactions', input, { today: TODAY }, { 'changes.amount': 'lots' });
  assert.equal(wrongType.ok, false);
  const unknownAccount = await previewAction(db as never, 'changeTransactions', input, { today: TODAY }, {
    'changes.accountId': 'b'.repeat(24),
  });
  assert.deepEqual(unknownAccount, {
    ok: false,
    problem: `changes.accountId "${'b'.repeat(24)}" is not an id from the account list`,
  });

  // Through the assistant: the approval comes back with a bad edit and nothing is saved.
  const proposal = await propose('changeTransactions', input);
  const before = snapshot();
  script = () => text('That could not be saved.');
  const after = await turn(respond(proposal.messages, true), {
    [proposal.callId]: { fields: { 'changes.accountId': 'b'.repeat(24) } },
  });
  assert.equal(toolPart(after, 'changeTransactions').state, 'output-denied');
  assert.equal(snapshot(), before);
  assert.equal(byId(chipotle.id)!.amount, 25.5);
});

test('dismissing a card saves nothing', async () => {
  const pizza = tx('Pizza place', '2026-11-14');
  const proposal = await propose('changeTransactions', { action: 'delete', transactionIds: [pizza.id] });
  const before = snapshot();
  script = () => text('OK, left as it is.');
  const after = await turn(respond(proposal.messages, false));
  assert.equal(toolPart(after, 'changeTransactions').state, 'output-denied');
  assert.equal(snapshot(), before);
});

test('the model gets the outcome of a saved change, not the whole card', async () => {
  const proposal = await propose('updateBudgets', { action: 'set', categoryId: ids.dining, amount: 100 });
  let seen = '';
  script = (prompt) => {
    seen = JSON.stringify(prompt);
    return text('Done.');
  };
  await turn(respond(proposal.messages, true));
  assert.match(seen, /\\"status\\":\\"saved\\"|"status":"saved"/);
  assert.match(seen, /recordsAffected/);
  assert.match(seen, /usedPct/);
  assert.ok(!seen.includes('"items"') && !seen.includes('\\"items\\"'), 'the card contents are not sent to the model');
});

test('every write tool has a card, a status line and instructions', async () => {
  assert.deepEqual([...WRITE_TOOL_PARTS].sort(), WRITE_TOOL_NAMES.map((name) => `tool-${name}`).sort());
  assert.equal(ACTION_NAMES.length, 8);
  assert.equal(proposalNoun('logTransactions', { items: [1, 2, 3] }), '3 transactions');
  assert.equal(proposalNoun('changeTransactions', { action: 'delete', transactionIds: ['a', 'b'] }), 'delete of 2 transactions');
  assert.equal(proposalNoun('moveMoney', { action: 'cardPayment' }), 'card payment');

  script = () => text('Hi');
  await turn([user('hello')]);
  const system = prompts[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  for (const name of [...ACTION_NAMES, 'linkToPage']) assert.ok(system.includes(name), `instructions mention ${name}`);
});
