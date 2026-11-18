/**
 * Storage for assistant conversations (Conversation and Message in
 * prisma/schema.prisma).
 *
 * Messages are stored in the AI SDK's UI message format, one row per message,
 * ordered by `position`. The server is the source of truth for history: the
 * browser sends only its newest message and lib/assistant/chat.ts rebuilds
 * the rest from here.
 *
 * A reply is written by `finishRun`, and only while its run still owns the
 * conversation (`activeRunId`). Stopping a reply, or sending another message
 * before the first reply finished, hands ownership on, so a late reply can
 * never overwrite newer messages.
 */
import type { PrismaClient } from '@prisma/client';

export type ChatDb = Pick<PrismaClient, 'conversation' | 'message' | '$transaction'>;
type ChatTx = Pick<PrismaClient, 'conversation' | 'message'>;

/** A UI message as stored: id, role and the parts array. */
export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: unknown[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  /** ISO timestamp of the last message. */
  lastMessageAt: string;
};

export type LoadedConversation = ConversationSummary & {
  titleState: string;
  /** True while a reply is still being produced (for example after the tab was closed mid-reply). */
  running: boolean;
  messages: StoredMessage[];
};

/**
 * A run older than this is treated as finished even if it never reported
 * back (the server was restarted mid-reply). The chat route's maxDuration is 60s.
 */
export const RUN_TIMEOUT_MS = 90_000;

export const MAX_TITLE_LENGTH = 80;

/**
 * The error a chat request gets when the browser's newest message does not
 * fit the stored conversation (it was changed in another tab, or the request
 * was a repeat). The chat screen reloads the conversation when it sees this.
 */
export const OUT_OF_SYNC = 'This chat changed somewhere else, so it was refreshed. Please try again.';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Conversation ids come from the browser: accept only an opaque token. */
export function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

/** One line, trimmed and cut to the title length. Empty input gives ''. */
export function cleanTitle(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : text;
}

/** The title a conversation has until one is generated: the start of its first message. */
export function placeholderTitle(message: StoredMessage | undefined): string {
  const parts = (message?.parts ?? []) as { type?: string; text?: string }[];
  const text = parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join(' ');
  const title = cleanTitle(text).slice(0, 60).trim();
  if (title) return title;
  return parts.some((p) => p.type === 'file') ? 'Image' : 'New chat';
}

const summary = (c: { id: string; title: string; lastMessageAt: Date }): ConversationSummary => ({
  id: c.id,
  title: c.title,
  lastMessageAt: c.lastMessageAt.toISOString(),
});

function isRunning(c: { activeRunId: string | null; runStartedAt: Date | null }, now: Date) {
  return (
    c.activeRunId !== null &&
    c.runStartedAt !== null &&
    now.getTime() - c.runStartedAt.getTime() < RUN_TIMEOUT_MS
  );
}

function toStored(row: { messageId: string; role: string; parts: string }): StoredMessage | null {
  try {
    const parts: unknown = JSON.parse(row.parts);
    if (!Array.isArray(parts)) return null;
    const role = row.role === 'user' || row.role === 'system' ? row.role : 'assistant';
    return { id: row.messageId, role, parts };
  } catch {
    return null;
  }
}

// ==================== READ ====================

export async function listConversations(db: ChatDb, limit = 200): Promise<ConversationSummary[]> {
  const rows = await db.conversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    take: limit,
    select: { id: true, title: true, lastMessageAt: true },
  });
  return rows.map(summary);
}

export async function loadConversation(
  db: ChatDb,
  id: string,
  now: Date = new Date()
): Promise<LoadedConversation | null> {
  if (!isConversationId(id)) return null;
  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) return null;
  const rows = await db.message.findMany({
    where: { conversationId: id },
    orderBy: { position: 'asc' },
    select: { messageId: true, role: true, parts: true },
  });
  return {
    ...summary(conversation),
    titleState: conversation.titleState,
    running: isRunning(conversation, now),
    messages: rows.map(toStored).filter((m): m is StoredMessage => m !== null),
  };
}

// ==================== RUNS ====================

async function replaceTail(
  tx: ChatTx,
  conversationId: string,
  fromPosition: number,
  messages: StoredMessage[]
) {
  await tx.message.deleteMany({ where: { conversationId, position: { gte: fromPosition } } });
  for (const [offset, message] of messages.entries()) {
    await tx.message.create({
      data: {
        conversationId,
        messageId: message.id,
        role: message.role,
        position: fromPosition + offset,
        parts: JSON.stringify(message.parts),
      },
    });
  }
}

/**
 * Start a reply: create the conversation if this is its first message,
 * replace everything from `fromPosition` on with `messages` (the user's new
 * or edited message, or the reply being continued after an approval), and
 * hand the conversation to `runId`.
 */
export async function beginRun(
  db: ChatDb,
  input: {
    id: string;
    runId: string;
    fromPosition: number;
    messages: StoredMessage[];
    /** Title for a conversation that does not exist yet. */
    title: string;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();
  await db.$transaction(async (tx: ChatTx) => {
    const existing = await tx.conversation.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    const run = { activeRunId: input.runId, runStartedAt: now, lastMessageAt: now };
    if (existing) {
      await tx.conversation.update({ where: { id: input.id }, data: run });
    } else {
      await tx.conversation.create({
        data: { id: input.id, title: input.title || 'New chat', titleState: 'placeholder', ...run },
      });
    }
    await replaceTail(tx, input.id, input.fromPosition, input.messages);
  });
}

/**
 * Save the reply of `runId` at `position` and release the conversation.
 * Returns false, saving nothing, when the run no longer owns the conversation
 * (it was stopped, superseded by a newer message, or the conversation was deleted).
 */
export async function finishRun(
  db: ChatDb,
  input: {
    id: string;
    runId: string;
    position: number;
    /** Null when the run produced nothing worth keeping. */
    message: StoredMessage | null;
    now?: Date;
  }
): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx: ChatTx) => {
    const conversation = await tx.conversation.findUnique({
      where: { id: input.id },
      select: { activeRunId: true },
    });
    if (!conversation || conversation.activeRunId !== input.runId) return false;
    if (input.message) await replaceTail(tx, input.id, input.position, [input.message]);
    await tx.conversation.update({
      where: { id: input.id },
      data: {
        activeRunId: null,
        runStartedAt: null,
        ...(input.message ? { lastMessageAt: now } : {}),
      },
    });
    return true;
  });
}

/**
 * Take the conversation away from whichever run owns it without saving a
 * reply. Used when a reply is stopped but its request is not running in this
 * process, so it cannot be aborted directly: its late result is discarded.
 */
export async function releaseRun(db: ChatDb, id: string): Promise<void> {
  await db.$transaction(async (tx: ChatTx) => {
    await tx.conversation.updateMany({
      where: { id },
      data: { activeRunId: null, runStartedAt: null },
    });
  });
}

// ==================== TITLE, RENAME, DELETE ====================

/** Replace the placeholder title with a generated one. Never touches a title the user chose. */
export async function setGeneratedTitle(db: ChatDb, id: string, title: string): Promise<boolean> {
  const clean = cleanTitle(title);
  if (!clean) return false;
  return db.$transaction(async (tx: ChatTx) => {
    const result = await tx.conversation.updateMany({
      where: { id, titleState: 'placeholder' },
      data: { title: clean, titleState: 'generated' },
    });
    return result.count > 0;
  });
}

export async function renameConversation(
  db: ChatDb,
  id: string,
  title: string
): Promise<ConversationSummary | null> {
  const clean = cleanTitle(title);
  if (!isConversationId(id) || !clean) return null;
  return db.$transaction(async (tx: ChatTx) => {
    const existing = await tx.conversation.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;
    const updated = await tx.conversation.update({
      where: { id },
      data: { title: clean, titleState: 'custom' },
    });
    return summary(updated);
  });
}

/** Delete a conversation and its messages. Returns false if it did not exist. */
export async function deleteConversation(db: ChatDb, id: string): Promise<boolean> {
  if (!isConversationId(id)) return false;
  return db.$transaction(async (tx: ChatTx) => {
    // Explicit, not left to the relation's cascade, so one transaction covers both.
    await tx.message.deleteMany({ where: { conversationId: id } });
    const result = await tx.conversation.deleteMany({ where: { id } });
    return result.count > 0;
  });
}
