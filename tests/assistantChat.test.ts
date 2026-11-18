/**
 * Persisted chat turns (lib/assistant/chat.ts, lib/assistant/conversations.ts)
 * with a scripted model and the fake database: saving and reloading a
 * conversation, surviving a client disconnect, stopping, editing and
 * regenerating, titles, rename and delete, and approving a proposal the user
 * edited on the card.
 *
 * The "browser" here does what the real one does: it keeps its own copy of
 * the messages and sends only the newest one.
 *
 * Run: npm test (vitest)
 */
import { beforeEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { readUIMessageStream, simulateReadableStream, type UIMessageChunk } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import { OUT_OF_SYNC, runChatTurn, stopChatRun } from '../lib/assistant/chat';
import {
  deleteConversation,
  listConversations,
  loadConversation,
  renameConversation,
} from '../lib/assistant/conversations';
import { groupConversations } from '../lib/assistant/conversationGroups';
import { runAssistant, type AssistantUIMessage } from '../lib/assistant/engine';
import { seedAssistantData, TODAY } from './support/assistantSeed';
import type { FakeDb } from './support/fakeDb';

type Prompt = Parameters<MockLanguageModelV4['doStream']>[0]['prompt'];
type Chunk = Record<string, unknown>;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finish = (reason: 'stop' | 'tool-calls'): Chunk => ({
  type: 'finish',
  finishReason: { unified: reason, raw: undefined },
  usage,
});
const text = (...deltas: string[]): Chunk[] => [
  { type: 'text-start', id: 't' },
  ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })),
  { type: 'text-end', id: 't' },
  finish('stop'),
];
const toolCall = (toolCallId: string, toolName: string, input: unknown): Chunk[] => [
  { type: 'tool-call', toolCallId, toolName, input: JSON.stringify(input) },
  finish('tool-calls'),
];

let db: FakeDb;
let ids: ReturnType<typeof seedAssistantData>['ids'];
let prompts: Prompt[];
let script: (prompt: Prompt) => Chunk[];
/** Milliseconds between model chunks; raise it to act while a reply streams. */
let chunkDelay: number;
let background: Promise<unknown>[];
let titles: string[];

const model = new MockLanguageModelV4({
  doStream: async ({ prompt }) => {
    prompts.push(prompt);
    return {
      stream: simulateReadableStream({
        chunks: script(prompt) as never[],
        chunkDelayInMs: chunkDelay,
      }),
    };
  },
});

beforeEach(() => {
  const seeded = seedAssistantData();
  db = seeded.db;
  ids = seeded.ids;
  prompts = [];
  chunkDelay = 0;
  background = [];
  titles = [];
});

const SECRET = 'test-secret-test-secret-test-secret';
const CHAT = 'chat_test_0001';

function request(message: unknown, extra: { id?: string; proposalEdits?: unknown } = {}) {
  return runChatTurn({
    chatDb: db as never,
    conversationId: extra.id ?? CHAT,
    message,
    proposalEdits: extra.proposalEdits,
    model,
    provider: 'openai',
    approvalSecret: SECRET,
    deps: {
      db: db as never,
      today: TODAY,
      timeZone: 'America/New_York',
      currency: 'USD',
      transactionDeps: { db: db as never, revalidate: () => {} },
    },
    generateTitle: async ({ userText }) => {
      titles.push(userText);
      return 'Costco groceries';
    },
    background: (work) => background.push(work),
  });
}

/** The response body's SSE lines as UI message chunks. */
function chunksOf(response: Response): ReadableStream<UIMessageChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = event.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (!data || data === '[DONE]') continue;
          controller.enqueue(JSON.parse(data));
          return;
        }
        const { done, value } = await reader.read();
        if (done) return controller.close();
        buffer += decoder.decode(value, { stream: true });
      }
    },
  });
}

/** What the browser does: send the newest message and apply the reply to its own copy. */
async function send(
  local: AssistantUIMessage[],
  extra: { proposalEdits?: unknown } = {}
): Promise<AssistantUIMessage[]> {
  const last = local[local.length - 1];
  const result = await request(structuredClone(last), extra);
  assert.ok(result.ok, result.ok ? '' : result.error);
  let reply: AssistantUIMessage | undefined;
  for await (const m of readUIMessageStream<AssistantUIMessage>({
    stream: chunksOf(result.response),
    message: last.role === 'assistant' ? structuredClone(last) : undefined,
    terminateOnError: false,
  })) {
    reply = m;
  }
  assert.ok(reply, 'stream produced a message');
  await Promise.all(background);
  return last.role === 'assistant' ? [...local.slice(0, -1), reply] : [...local, reply];
}

let nextId = 0;
const user = (t: string, id = `u${++nextId}`): AssistantUIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: t }],
});

const textOf = (m: { parts: unknown[] }) =>
  (m.parts as { type: string; text?: string }[])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');

type WritePart = Extract<AssistantUIMessage['parts'][number], { type: 'tool-createExpense' }>;
const writePart = (m: { parts: unknown[] }) => {
  const part = (m.parts as { type: string }[]).find((p) => p.type === 'tool-createExpense');
  assert.ok(part, 'message has a createExpense part');
  return part as WritePart;
};

/** What useChat's addToolApprovalResponse does to the browser's copy. */
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

const stored = async () => (await loadConversation(db as never, CHAT))!;
const expenses = () => db.data.transaction.filter((t) => t.kind === 'EXPENSE');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function untilIdle() {
  for (let i = 0; i < 200; i++) {
    if (db.data.conversation[0]?.activeRunId === null) return;
    await sleep(10);
  }
  assert.fail('the run never finished');
}

const proposeCostco = () =>
  toolCall('call_costco', 'createExpense', {
    amount: 20,
    date: TODAY,
    categoryId: ids.groceries,
    accountId: ids.discover,
    merchant: 'Costco',
  });

// ==================== PERSISTENCE ====================

test('a conversation is saved turn by turn and reloads as it was shown', async () => {
  script = () => text('You spent ', '$140.30', ' on groceries in March.');
  let local = await send([user('How much did I spend on groceries in March?')]);

  let saved = await stored();
  assert.deepEqual(saved.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(textOf(saved.messages[1]), 'You spent $140.30 on groceries in March.');
  // The reply's id comes from the server and is the one the browser was sent.
  assert.match(saved.messages[1].id, /^msg-/);
  assert.equal(saved.messages[1].id, local[1].id);
  assert.equal(saved.running, false);

  // The browser sends only its newest message; the model still gets the history.
  script = (prompt) => {
    assert.match(JSON.stringify(prompt), /groceries in March\?/);
    assert.match(JSON.stringify(prompt), /\$140\.30/);
    return text('April was $85.35.');
  };
  local = await send([...local, user('And April?')]);

  saved = await stored();
  assert.deepEqual(
    saved.messages.map((m) => [m.role, textOf(m)]),
    [
      ['user', 'How much did I spend on groceries in March?'],
      ['assistant', 'You spent $140.30 on groceries in March.'],
      ['user', 'And April?'],
      ['assistant', 'April was $85.35.'],
    ]
  );
  assert.deepEqual(saved.messages.map((m) => m.id), local.map((m) => m.id));
  assert.deepEqual(db.data.message.map((m) => m.position), [0, 1, 2, 3]);
});

test('the title starts as the first message and is replaced by a generated one, once', async () => {
  script = () => text('Hello.');
  chunkDelay = 15;
  const pending = request(user('spent 20 at costco from discover, groceries'));
  const result = await pending;
  assert.ok(result.ok);
  // Saved before the model has answered: the sidebar can already show it.
  assert.equal(db.data.conversation[0].title, 'spent 20 at costco from discover, groceries');
  assert.equal(db.data.conversation[0].titleState, 'placeholder');
  await result.response.text();
  await Promise.all(background);

  assert.deepEqual(titles, ['spent 20 at costco from discover, groceries']);
  assert.equal((await stored()).title, 'Costco groceries');

  chunkDelay = 0;
  script = () => text('Sure.');
  await send([user('thanks')]);
  assert.equal(titles.length, 1, 'generated only for the first exchange');
});

test('a reply finishes and is saved after the browser disconnects', async () => {
  chunkDelay = 15;
  script = () => text('One ', 'two ', 'three ', 'four ', 'five.');
  const result = await request(user('count to five'));
  assert.ok(result.ok);

  // Read the first chunk, then go away, as a closed tab does.
  const reader = result.response.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal((await loadConversation(db as never, CHAT))!.running, true);

  await untilIdle();
  const saved = await stored();
  assert.deepEqual(saved.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(textOf(saved.messages[1]), 'One two three four five.');
  assert.equal(saved.running, false);
});

test('stopping a reply keeps what was written and saves nothing after it', async () => {
  chunkDelay = 25;
  script = () => text('One ', 'two ', 'three ', 'four ', 'five ', 'six ', 'seven ', 'eight.');
  const result = await request(user('count to eight'));
  assert.ok(result.ok);
  const reading = result.response.text();
  await sleep(90);

  assert.equal(await stopChatRun(db as never, CHAT), 'aborted');
  await reading;
  await untilIdle();

  const saved = await stored();
  assert.equal(saved.running, false);
  assert.equal(saved.messages[0].role, 'user');
  const reply = saved.messages[1] ? textOf(saved.messages[1]) : '';
  assert.ok('One two three four five six seven eight.'.startsWith(reply), `partial reply: "${reply}"`);
  assert.notEqual(reply, 'One two three four five six seven eight.');
  assert.ok(saved.messages.length <= 2);

  // With no request to abort (another server instance), the late reply is discarded.
  assert.equal(await stopChatRun(db as never, CHAT), 'released');
});

test('a reply that takes too long is cut off, keeping what was written', async () => {
  chunkDelay = 30;
  script = () => text('One ', 'two ', 'three ', 'four ', 'five ', 'six ', 'seven ', 'eight.');
  const result = await runChatTurn({
    chatDb: db as never,
    conversationId: CHAT,
    message: user('count to eight'),
    model,
    provider: 'openai',
    approvalSecret: SECRET,
    deps: { db: db as never, today: TODAY, timeZone: 'America/New_York', currency: 'USD' },
    generateTitle: async () => null,
    runLimitMs: 100,
  });
  assert.ok(result.ok);
  await result.response.text();
  await untilIdle();
  const saved = await stored();
  assert.equal(saved.running, false);
  const reply = saved.messages[1] ? textOf(saved.messages[1]) : '';
  assert.notEqual(reply, 'One two three four five six seven eight.');
  assert.ok('One two three four five six seven eight.'.startsWith(reply));
});

test('a reply that finishes after its chat was released is not saved', async () => {
  chunkDelay = 15;
  script = () => text('One ', 'two ', 'three.');
  const result = await request(user('count'));
  assert.ok(result.ok);
  // As if Stop reached a different server instance: ownership is taken away.
  db.data.conversation[0].activeRunId = null;
  await result.response.text();
  await sleep(20);
  assert.deepEqual((await stored()).messages.map((m) => m.role), ['user']);
});

test('editing an earlier message replaces it and drops what followed', async () => {
  script = () => text('First answer.');
  let local = await send([user('what did I spend in March?', 'u-first')]);
  script = () => text('Second answer.');
  local = await send([...local, user('and April?')]);
  assert.equal((await stored()).messages.length, 4);

  // sendMessage({ messageId }) keeps the id and truncates the browser's copy.
  script = (prompt) => {
    assert.doesNotMatch(JSON.stringify(prompt), /First answer|and April/);
    return text('May answer.');
  };
  local = await send([user('what did I spend in May?', 'u-first')]);

  assert.deepEqual(
    (await stored()).messages.map((m) => textOf(m)),
    ['what did I spend in May?', 'May answer.']
  );
  assert.deepEqual(db.data.message.map((m) => m.position), [0, 1]);
});

test('regenerating replaces the last reply', async () => {
  script = () => text('First try.');
  const local = await send([user('how am I doing?')]);
  const firstReplyId = local[1].id;

  // regenerate() drops the reply and re-sends the user message before it.
  script = () => text('Second try.');
  const again = await send([local[0]]);

  const saved = await stored();
  assert.deepEqual(saved.messages.map((m) => textOf(m)), ['how am I doing?', 'Second try.']);
  assert.notEqual(saved.messages[1].id, firstReplyId);
  assert.equal(saved.messages[1].id, again[1].id);
});

test('a failed reply keeps the user message so it can be retried', async () => {
  script = () => [{ type: 'error', error: new Error('model is down') }];
  const result = await request(user('hello'));
  assert.ok(result.ok);
  await result.response.text();
  await untilIdle();
  const saved = await stored();
  assert.deepEqual(saved.messages.map((m) => m.role), ['user']);
  assert.equal(saved.running, false);
});

test('a reply that fails part-way is not stored as if it were complete', async () => {
  script = () => [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'September: $378.84. October: ' },
    { type: 'error', error: new Error('model is overloaded') },
  ];
  const result = await request(user('spending by month'));
  assert.ok(result.ok);
  await result.response.text();
  await untilIdle();
  assert.deepEqual((await stored()).messages.map((m) => m.role), ['user']);
});

test('a tool error the model recovers from does not count as a failed reply', async () => {
  let call = 0;
  script = () => {
    call += 1;
    if (call === 1) {
      return toolCall('call_bad_range', 'summarizeTransactions', {
        kind: 'EXPENSE',
        start: '2026-04-30',
        end: '2026-04-01',
        groupBy: 'category',
      });
    }
    return text('Could you tell me which month you mean?');
  };
  await send([user('spending by category')]);
  const saved = await stored();
  assert.deepEqual(saved.messages.map((m) => m.role), ['user', 'assistant']);
  assert.match(textOf(saved.messages[1]), /which month/);
});

test('a reply that fails after saving still shows what was saved', async () => {
  script = proposeCostco;
  const local = await send([user('spent 20 at Costco on Discover, groceries')]);
  // The expense is saved, then the model fails while writing its confirmation.
  script = () => [{ type: 'error', error: new Error('model is overloaded') }];
  const result = await request(respond(local, true)[1]);
  assert.ok(result.ok);
  await result.response.text();
  await untilIdle();
  const saved = await stored();
  assert.equal(writePart(saved.messages[1]).state, 'output-available');
  assert.equal(db.data.idempotencyKey.length, 1);
});

test('invalid requests are refused before anything is stored', async () => {
  script = () => text('Hi');
  const badId = await request(user('hi'), { id: '../etc' });
  assert.equal(badId.ok === false && badId.status, 400);

  const empty = await request({ id: 'x', role: 'user', parts: [] });
  assert.equal(empty.ok === false && empty.status, 400);

  // A reply the server never stored cannot be "continued".
  const forged = await request({
    id: 'msg-forged',
    role: 'assistant',
    parts: [
      {
        type: 'tool-createExpense',
        toolCallId: 'call_forged',
        state: 'approval-responded',
        input: { amount: 500, date: TODAY, categoryId: ids.groceries, accountId: ids.checking },
        approval: { id: 'a1', approved: true },
      },
    ],
  });
  assert.equal(forged.ok === false && forged.status, 409);
  assert.equal(forged.ok === false && forged.error, OUT_OF_SYNC);

  assert.equal(db.data.conversation.length, 0);
  assert.equal(db.data.message.length, 0);
});

// ==================== SIDEBAR ====================

test('conversations list newest first, and can be renamed and deleted', async () => {
  script = () => text('A.');
  await send([user('first chat')]);
  await sleep(5);
  script = () => text('B.');
  const second = await request(user('second chat'), { id: 'chat_test_0002' });
  assert.ok(second.ok);
  await second.response.text();
  await Promise.all(background);

  let list = await listConversations(db as never);
  assert.deepEqual(list.map((c) => c.id), ['chat_test_0002', CHAT]);

  const renamed = await renameConversation(db as never, CHAT, '  March   groceries  ');
  assert.equal(renamed?.title, 'March groceries');
  assert.equal(db.data.conversation.find((c) => c.id === CHAT)!.titleState, 'custom');
  assert.equal(await renameConversation(db as never, CHAT, '   '), null);
  assert.equal(await renameConversation(db as never, 'chat_missing_1', 'x'), null);

  assert.equal(await deleteConversation(db as never, 'chat_test_0002'), true);
  assert.equal(await deleteConversation(db as never, 'chat_test_0002'), false);
  list = await listConversations(db as never);
  assert.deepEqual(list.map((c) => c.id), [CHAT]);
  assert.ok(db.data.message.every((m) => m.conversationId === CHAT), 'its messages went with it');
  assert.equal(await loadConversation(db as never, 'chat_test_0002'), null);
});

test('a generated title never replaces a name the user chose', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  script = () => text('Hi.');
  const result = await runChatTurn({
    chatDb: db as never,
    conversationId: CHAT,
    message: user('hello'),
    model,
    provider: 'openai',
    approvalSecret: SECRET,
    deps: { db: db as never, today: TODAY, timeZone: 'America/New_York', currency: 'USD' },
    generateTitle: async () => {
      await held;
      return 'Generated title';
    },
    background: (work) => background.push(work),
  });
  assert.ok(result.ok);
  await result.response.text();
  // The user renames while the title is still being generated.
  await renameConversation(db as never, CHAT, 'My name for it');
  release();
  await Promise.all(background);
  assert.equal((await stored()).title, 'My name for it');
});

test('the sidebar groups conversations by the user\'s calendar days', () => {
  const at = (iso: string, id: string) => ({ id, title: id, lastMessageAt: iso });
  const groups = groupConversations(
    [
      at('2026-11-17T15:00:00Z', 'today'),
      // 03:30 UTC on the 17th is still the 16th in New York.
      at('2026-11-17T03:30:00Z', 'yesterday-evening'),
      at('2026-11-12T12:00:00Z', 'this-week'),
      at('2026-10-25T12:00:00Z', 'this-month'),
      at('2026-08-03T12:00:00Z', 'august'),
      at('2026-08-01T12:00:00Z', 'august-2'),
    ],
    TODAY,
    'America/New_York'
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((i) => i.id)]),
    [
      ['Today', ['today']],
      ['Yesterday', ['yesterday-evening']],
      ['Previous 7 days', ['this-week']],
      ['Previous 30 days', ['this-month']],
      ['August 2026', ['august', 'august-2']],
    ]
  );
});

// ==================== EDITED PROPOSALS ====================

test('approving an edited proposal saves once, with the edited values', async () => {
  const before = expenses().length;
  script = proposeCostco;
  let local = await send([user('spent 20 at Costco on Discover, groceries')]);
  const proposal = writePart(local[1]);
  assert.equal(proposal.state, 'approval-requested');
  assert.equal(expenses().length, before, 'nothing saved before approval');

  // On the card the user changes the amount, the date, the account and the
  // merchant, then approves.
  const edits = {
    call_costco: {
      amount: 25.5,
      date: '2026-11-15',
      accountId: ids.chase,
      merchant: "Trader Joe's",
    },
  };
  script = (prompt) => {
    // The model is told what was really saved.
    assert.match(JSON.stringify(prompt), /"editedByUser":true/);
    assert.match(JSON.stringify(prompt), /\$25\.50/);
    return text('Saved $25.50.');
  };
  const approved = respond(local, true);
  local = await send(approved, { proposalEdits: edits });

  const saved = writePart(local[1]);
  assert.equal(saved.state, 'output-available');
  assert.ok(saved.state === 'output-available');
  assert.equal(saved.output.editedByUser, true);
  assert.equal(saved.output.alreadySaved, false);
  assert.equal(
    saved.output.summary,
    "Expense $25.50 at Trader Joe's · Groceries · from Chase Card · 2026-11-15"
  );
  assert.deepEqual(saved.output.details, {
    amount: 25.5,
    date: '2026-11-15',
    category: 'Groceries',
    subcategory: null,
    account: 'Chase Card',
    merchant: "Trader Joe's",
  });
  // The proposal the server signed is unchanged; the edit travelled beside it.
  assert.equal(saved.input.amount, 20);

  const created = expenses().slice(before);
  assert.equal(created.length, 1);
  assert.equal(created[0].amount, 25.5);
  assert.equal(created[0].accountId, ids.chase);
  assert.equal(created[0].categoryId, ids.groceries);
  assert.equal(created[0].merchantOrSource, "Trader Joe's");
  assert.equal(created[0].date.toISOString().slice(0, 10), '2026-11-15');
  assert.deepEqual(db.data.idempotencyKey.map((k) => k.key), ['assistant:call_costco']);

  // The saved state is what a reload shows.
  const reloaded = writePart((await stored()).messages[1]);
  assert.equal(reloaded.state, 'output-available');

  // A double tap re-sends the same approval: it is already handled.
  const again = await request(structuredClone(approved[1]), { proposalEdits: edits });
  assert.equal(again.ok === false && again.status, 409);
  assert.equal(expenses().length, before + 1);

  // Even a replay that reaches the engine with different edits returns the
  // first save instead of writing a second transaction.
  script = () => text('Already saved.');
  const replay = await runAssistant({
    messages: structuredClone(approved),
    model,
    provider: 'openai',
    approvalSecret: SECRET,
    proposalEdits: { call_costco: { amount: 99 } },
    deps: {
      db: db as never,
      today: TODAY,
      timeZone: 'America/New_York',
      currency: 'USD',
      transactionDeps: { db: db as never, revalidate: () => {} },
    },
  });
  assert.ok(replay.ok);
  let replayed: AssistantUIMessage | undefined;
  for await (const m of readUIMessageStream<AssistantUIMessage>({
    stream: replay.stream,
    message: structuredClone(approved[1]),
    terminateOnError: false,
  })) {
    replayed = m;
  }
  const replayPart = writePart(replayed!);
  assert.ok(replayPart.state === 'output-available');
  assert.equal(replayPart.output.alreadySaved, true);
  assert.equal(replayPart.output.details.amount, 25.5, 'describes the first save');
  assert.equal(replayPart.output.editedByUser, undefined);
  assert.equal(expenses().length, before + 1);
  assert.equal(expenses()[expenses().length - 1].amount, 25.5);
});

test('changing the category on the card drops the proposed subcategory', async () => {
  const produce = db.data.subcategory.find((s) => s.name === 'Produce')!;
  script = () =>
    toolCall('call_sub', 'createExpense', {
      amount: 12,
      date: TODAY,
      categoryId: ids.groceries,
      subcategoryId: produce.id,
      accountId: ids.checking,
    });
  const local = await send([user('12 on produce from checking')]);
  script = () => text('Saved.');
  const done = await send(respond(local, true), {
    proposalEdits: { call_sub: { categoryId: ids.dining } },
  });
  const part = writePart(done[1]);
  assert.ok(part.state === 'output-available');
  const row = db.data.transaction.find((t) => t.id === part.output.transactionId)!;
  assert.equal(row.categoryId, ids.dining);
  assert.equal(row.subcategoryId, null);
});

test('an edit the server cannot accept saves nothing', async () => {
  const before = db.data.transaction.length;
  script = proposeCostco;
  const local = await send([user('spent 20 at Costco on Discover, groceries')]);

  // An income category on an expense: valid shape, wrong meaning.
  script = (prompt) => {
    assert.match(JSON.stringify(prompt), /changed this proposal before approving/);
    assert.match(JSON.stringify(prompt), /Salary.*is an income category/);
    return text('That category is for income. Want me to propose it again?');
  };
  const done = await send(respond(local, true), {
    proposalEdits: { call_costco: { categoryId: ids.salary } },
  });
  assert.equal(writePart(done[1]).state, 'output-denied');
  assert.equal(db.data.transaction.length, before);
  assert.equal(db.data.idempotencyKey.length, 0);

  // A malformed edit never reaches the tools at all.
  script = proposeCostco;
  const other = await request(user('again'), { id: 'chat_test_0003' });
  assert.ok(other.ok);
  const reply = await (async () => {
    let m: AssistantUIMessage | undefined;
    for await (const x of readUIMessageStream<AssistantUIMessage>({ stream: chunksOf(other.response) })) m = x;
    return m!;
  })();
  for (const bad of [
    { call_costco: { amount: -5 } },
    { call_costco: { date: '2026-02-30' } },
    { call_costco: { amount: 5, kind: 'INCOME' } },
    'not an object',
  ]) {
    const refused = await request(respond([reply], true)[0], { id: 'chat_test_0003', proposalEdits: bad });
    assert.equal(refused.ok === false && refused.status, 400, JSON.stringify(bad));
  }
  assert.equal(db.data.transaction.length, before);
});

test('only the approval is taken from the browser, not its copy of the proposal', async () => {
  const before = expenses().length;
  script = proposeCostco;
  const local = await send([user('spent 20 at Costco on Discover, groceries')]);

  // The browser's copy claims a different amount and account. The stored,
  // signed proposal is what gets approved.
  const tampered = respond(local, true).map((m) => ({
    ...m,
    parts: m.parts.map((p) =>
      p.type === 'tool-createExpense'
        ? { ...p, input: { ...p.input, amount: 2000, accountId: ids.checking } }
        : p
    ),
  })) as AssistantUIMessage[];
  script = () => text('Saved.');
  const result = await request(tampered[1]);
  assert.ok(result.ok);
  await result.response.text();
  await untilIdle();

  const created = expenses().slice(before);
  assert.equal(created.length, 1);
  assert.equal(created[0].amount, 20);
  assert.equal(created[0].accountId, ids.discover);
});

test('discarding a proposal saves nothing and shows as discarded after a reload', async () => {
  const before = db.data.transaction.length;
  script = proposeCostco;
  const local = await send([user('spent 20 at Costco on Discover, groceries')]);
  script = () => text('OK, not saved.');
  await send(respond(local, false), { proposalEdits: { call_costco: { amount: 30 } } });
  assert.equal(db.data.transaction.length, before);
  assert.equal(writePart((await stored()).messages[1]).state, 'output-denied');
});
