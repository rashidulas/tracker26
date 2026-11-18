/**
 * End-to-end assistant turns with a scripted model and the fake database:
 * conversation memory, proposals, approval, exactly-once saving, forged
 * approvals and proposals the server rejects.
 *
 * The model is MockLanguageModelV4 from ai/test; everything else (tool
 * definitions, approval rules, signing, lib/transactions) is the real code.
 *
 * Run: npm test (vitest)
 */
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readUIMessageStream, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import { runAssistant, type AssistantUIMessage } from '../lib/assistant/engine';
import { INVALID_PROPOSAL_PREFIX } from '../lib/assistant/tools';
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

/** Plain text of every message in a prompt, for assertions. */
function promptText(prompt: Prompt) {
  return JSON.stringify(prompt);
}

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

/** One request, as the client sends it: a fresh JSON copy of the conversation. */
async function turn(sent: AssistantUIMessage[]) {
  const messages: AssistantUIMessage[] = structuredClone(sent);
  const result = await runAssistant({
    messages,
    model,
    provider: 'openai',
    approvalSecret: 'test-secret-test-secret-test-secret',
    deps: {
      db: db as never,
      today: TODAY,
      timeZone: 'America/New_York',
      currency: 'USD',
      transactionDeps: { db: db as never, revalidate: () => {} },
    },
  });
  assert.ok(result.ok, result.ok ? '' : result.error);
  const last = messages[messages.length - 1];
  let message: AssistantUIMessage | undefined;
  for await (const m of readUIMessageStream<AssistantUIMessage>({
    stream: result.stream,
    // Continuing an assistant message (after an approval) appends to it.
    message: last.role === 'assistant' ? last : undefined,
    terminateOnError: false,
  })) {
    message = m;
  }
  assert.ok(message, 'stream produced a message');
  // Continuations re-use the last message; new turns append one.
  return last.role === 'assistant'
    ? [...messages.slice(0, -1), message]
    : [...messages, message];
}

let nextId = 0;
const user = (t: string): AssistantUIMessage => ({
  id: `u${++nextId}`,
  role: 'user',
  parts: [{ type: 'text', text: t }],
});

function writePart(message: AssistantUIMessage) {
  const part = message.parts.find((p) => p.type === 'tool-createExpense' || p.type === 'tool-createIncome');
  assert.ok(part, 'message has a write tool part');
  return part as Extract<AssistantUIMessage['parts'][number], { type: 'tool-createExpense' }>;
}

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

const expenses = () => db.data.transaction.filter((t) => t.kind === 'EXPENSE');

test('"spent 20 at Costco from Discover" then "groceries" saves one expense on Discover, once', async () => {
  const before = expenses().length;

  // Turn 1: the model asks for the category.
  script = () => text('Which category should I use?');
  let messages = await turn([user('spent 20 at Costco from Discover')]);
  assert.equal(messages.length, 2);

  // Turn 2: "groceries". The model sees the whole conversation, so it still
  // knows the account, and proposes once.
  script = (prompt) => {
    assert.match(promptText(prompt), /from Discover/);
    return toolCall('call_costco', 'createExpense', {
      amount: 20,
      date: TODAY,
      categoryId: ids.groceries,
      accountId: ids.discover,
      merchant: 'Costco',
    });
  };
  messages = await turn([...messages, user('groceries')]);
  const proposal = writePart(messages[messages.length - 1]);
  assert.equal(proposal.state, 'approval-requested');
  assert.equal(
    proposal.state === 'approval-requested' && proposal.approval.requestReason,
    `Expense $20.00 at Costco · Groceries · from Discover · ${TODAY}`
  );
  assert.equal(expenses().length, before, 'nothing saved before approval');

  // Turn 3: the user approves. The tool runs, then the model replies.
  script = (prompt) => {
    assert.match(promptText(prompt), /"status":"saved"/);
    return text('Saved.');
  };
  const approved = respond(messages, true);
  messages = await turn(approved);
  const saved = writePart(messages[messages.length - 1]);
  assert.equal(saved.state, 'output-available');
  assert.equal(saved.state === 'output-available' && saved.output.alreadySaved, false);

  const created = expenses().slice(before);
  assert.equal(created.length, 1);
  assert.equal(created[0].amount, 20);
  assert.equal(created[0].accountId, ids.discover);
  assert.equal(created[0].categoryId, ids.groceries);
  assert.equal(created[0].merchantOrSource, 'Costco');
  assert.equal(db.data.idempotencyKey.length, 1);
  assert.equal(db.data.idempotencyKey[0].key, 'assistant:call_costco');

  // A retried request (or a double tap) replays the same approval: no second save.
  const replay = await turn(approved);
  const again = writePart(replay[replay.length - 1]);
  assert.equal(again.state === 'output-available' && again.output.alreadySaved, true);
  assert.equal(expenses().length, before + 1);
});

test('a forged or edited approval is rejected and nothing is saved', async () => {
  const before = db.data.transaction.length;
  script = () =>
    toolCall('call_x', 'createExpense', {
      amount: 20,
      date: TODAY,
      categoryId: ids.groceries,
      accountId: ids.discover,
    });
  const messages = await turn([user('20 for groceries on Discover')]);
  const approved = respond(messages, true);

  // The client changes the amount after the server signed the request.
  const tampered = approved.map((m) => ({
    ...m,
    parts: m.parts.map((p) =>
      p.type === 'tool-createExpense' ? { ...p, input: { ...p.input, amount: 2000 } } : p
    ),
  })) as AssistantUIMessage[];
  script = () => text('Saved.');
  const result = await runAssistant({
    messages: tampered,
    model,
    provider: 'openai',
    approvalSecret: 'test-secret-test-secret-test-secret',
    deps: {
      db: db as never,
      today: TODAY,
      timeZone: 'America/New_York',
      currency: 'USD',
      transactionDeps: { db: db as never, revalidate: () => {} },
    },
  }).catch((e) => ({ ok: false as const, error: String(e) }));
  if (result.ok) {
    // Drain the stream; the SDK reports the bad signature as a stream error.
    const reader = result.stream.getReader();
    while (!(await reader.read()).done) {
      /* drain */
    }
  }
  assert.equal(db.data.transaction.length, before, 'tampered approval did not save');
});

test('the user denying a proposal saves nothing and tells the model', async () => {
  const before = db.data.transaction.length;
  script = () =>
    toolCall('call_no', 'createExpense', {
      amount: 9,
      date: TODAY,
      categoryId: ids.dining,
      accountId: ids.chase,
    });
  const messages = await turn([user('9 at the cafe on chase, dining')]);
  script = (prompt) => {
    assert.match(promptText(prompt), /execution-denied/);
    return text('OK, not saved.');
  };
  const denied = await turn(respond(messages, false));
  assert.equal(writePart(denied[denied.length - 1]).state, 'output-denied');
  assert.equal(db.data.transaction.length, before);
});

test('an invalid proposal is bounced back to the model, not shown to the user', async () => {
  const before = db.data.transaction.length;
  let call = 0;
  script = (prompt) => {
    call += 1;
    if (call === 1) {
      // Wrong kind of category for an expense.
      return toolCall('call_bad', 'createExpense', {
        amount: 5,
        date: TODAY,
        categoryId: ids.salary,
        accountId: ids.checking,
      });
    }
    assert.ok(promptText(prompt).includes(INVALID_PROPOSAL_PREFIX));
    assert.match(promptText(prompt), /Salary.*is an income category/);
    return text('Which expense category?');
  };
  const messages = await turn([user('5 from checking')]);
  const part = writePart(messages[messages.length - 1]);
  assert.equal(part.state, 'output-denied');
  assert.equal(part.state === 'output-denied' && part.approval.isAutomatic, true);
  assert.equal(call, 2, 'the model got a second step to fix it');
  assert.equal(db.data.transaction.length, before);
});

test('a proposal left unanswered is reported to the model as not saved', async () => {
  script = () =>
    toolCall('call_skip', 'createExpense', {
      amount: 7,
      date: TODAY,
      categoryId: ids.dining,
      accountId: ids.chase,
    });
  let messages = await turn([user('7 on chase for dining')]);
  script = (prompt) => {
    assert.match(promptText(prompt), /sent a new message instead of approving/);
    return text('Sure.');
  };
  messages = await turn([...messages, user('actually never mind, what is my Discover balance?')]);
  assert.equal(messages.length, 4);
});

test('read tools run without approval and errors reach the model as text', async () => {
  let call = 0;
  script = (prompt) => {
    call += 1;
    if (call === 1) {
      return toolCall('call_sum', 'comparePeriods', {
        kind: 'EXPENSE',
        categoryIds: [ids.groceries],
        periodA: { start: '2026-03-01', end: '2026-03-31' },
        periodB: { start: '2026-04-31', end: '2026-04-30' },
      });
    }
    if (call === 2) {
      // The model sees a readable validation error and corrects the date.
      assert.match(promptText(prompt), /real calendar day/);
      return toolCall('call_sum2', 'comparePeriods', {
        kind: 'EXPENSE',
        categoryIds: [ids.groceries],
        periodA: { start: '2026-03-01', end: '2026-03-31' },
        periodB: { start: '2026-04-01', end: '2026-04-30' },
      });
    }
    assert.match(promptText(prompt), /"change":-54.95/);
    return text('You spent $140.30 in March and $85.35 in April, $54.95 less.');
  };
  const messages = await turn([user('how much did I spend on groceries in March versus April?')]);
  const reply = messages[messages.length - 1];
  const finalText = reply.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
  assert.match(finalText, /\$54\.95 less/);
  assert.equal(call, 3);
});

test('instructions carry accounts, categories, currency, timezone and today', async () => {
  script = () => text('Hi');
  await turn([user('hello')]);
  const system = prompts[0].filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert.match(system, /Discover \[CREDIT_CARD\]/);
  assert.match(system, /Groceries \(.+\); subcategories: Produce/);
  assert.match(system, /Currency: USD/);
  assert.match(system, /Time zone: America\/New_York/);
  assert.match(system, /Today is Tuesday, 2026-11-17\./);
  assert.ok(system.indexOf('# Untrusted content') < system.indexOf('# Accounts'), 'stable text first');
  assert.ok(system.indexOf('# Accounts') < system.indexOf('Today is'), 'date last');
});
