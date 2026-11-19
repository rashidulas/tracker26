/**
 * The chat assistant engine: one streamed, multi-step tool-calling turn.
 *
 * The client (useChat) sends the whole conversation as UI messages on every
 * request, including earlier images, tool results and approval decisions.
 * This module validates that history, builds the instructions, and runs
 * streamText with the read and write tools. Writes wait for the user's
 * approval (lib/assistant/tools.ts); approvals are HMAC-signed so a client
 * cannot forge one.
 *
 * Kept free of Next.js so tests can drive it with a mock model and a fake
 * database.
 */
import { randomBytes } from 'node:crypto';
import {
  convertToModelMessages,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
  type InferUITools,
  type LanguageModel,
  type SystemModelMessage,
  type UIDataTypes,
  type UIMessage,
} from 'ai';
import type { DayString } from '@/lib/dates';
import {
  ASSISTANT_BEHAVIOUR,
  buildDataSection,
  buildDateSection,
  type PromptContext,
} from '@/lib/assistant/prompt';
import {
  buildAssistantTools,
  buildToolApproval,
  proposalEditsSchema,
  type AssistantToolDeps,
  type AssistantTools,
} from '@/lib/assistant/tools';
import { cacheBreakpoint, providerOptionsFor, type AssistantProvider } from '@/lib/assistant/model';
import { contextSection, type AskContext } from '@/lib/assistant/context';

/** UI message type for the client (useChat<AssistantUIMessage>). */
export type AssistantUIMessage = UIMessage<never, UIDataTypes, InferUITools<AssistantTools>>;

export const MAX_STEPS = 10;
const MAX_MERCHANT_DEFAULTS = 150;

// ==================== PROMPT CONTEXT ====================

export async function loadPromptContext(
  db: AssistantToolDeps['db'],
  settings: { today: DayString; timeZone: string; currency: string }
): Promise<PromptContext> {
  const [accounts, categories, subcategories, merchants] = await Promise.all([
    db.account.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
    db.category.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
    db.subcategory.findMany({
      select: { id: true, name: true, categoryId: true },
      orderBy: { name: 'asc' },
    }),
    // Same filter as lib/merchantLookup.ts listMerchantDefaults.
    db.merchant.findMany({
      where: { OR: [{ defaultCategoryId: { not: null } }, { defaultAccountId: { not: null } }] },
      select: {
        name: true,
        defaultCategoryId: true,
        defaultSubcategoryId: true,
        defaultAccountId: true,
      },
      orderBy: { name: 'asc' },
      take: MAX_MERCHANT_DEFAULTS,
    }),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  return {
    ...settings,
    merchantDefaults: merchants.map((m) => {
      const category = m.defaultCategoryId ? categoryById.get(m.defaultCategoryId) ?? null : null;
      const account = m.defaultAccountId ? accountById.get(m.defaultAccountId) ?? null : null;
      return {
        name: m.name,
        category,
        subcategoryId: category ? m.defaultSubcategoryId : null,
        account: account ? { id: account.id, name: account.name } : null,
      };
    }),
    accounts,
    categories: categories.map((c) => ({
      ...c,
      subcategories: subcategories
        .filter((s) => s.categoryId === c.id)
        .map((s) => ({ id: s.id, name: s.name })),
    })),
  };
}

export function buildInstructions(
  ctx: PromptContext,
  provider: AssistantProvider,
  /** Set for a chat opened with "Ask about this". Last, so the cached prefix is shared. */
  context?: AskContext | null
): SystemModelMessage[] {
  return [
    { role: 'system', content: ASSISTANT_BEHAVIOUR },
    // Accounts and categories change rarely: cache through here.
    { role: 'system', content: buildDataSection(ctx), ...cacheBreakpoint(provider) },
    { role: 'system', content: buildDateSection(ctx.today) },
    ...(context ? [{ role: 'system' as const, content: contextSection(context) }] : []),
  ];
}

// ==================== HISTORY ====================

const SUPERSEDED_REASON =
  'The user sent a new message instead of approving this proposal. Nothing was saved.';

/**
 * A proposal still waiting for approval when the user sends a new message was
 * not approved. Record it as denied so the model knows nothing was saved
 * (the SDK would otherwise drop the call silently).
 */
export function supersedePendingApprovals<M extends UIMessage>(messages: M[]): M[] {
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  return messages.map((message, index) => {
    if (index >= lastUser || message.role !== 'assistant') return message;
    let changed = false;
    const parts = message.parts.map((part) => {
      if (
        'state' in part &&
        part.state === 'approval-requested' &&
        'approval' in part &&
        part.approval &&
        !part.approval.isAutomatic
      ) {
        changed = true;
        return {
          ...part,
          state: 'output-denied',
          approval: { id: part.approval.id, approved: false, reason: SUPERSEDED_REASON },
        };
      }
      return part;
    });
    return changed ? ({ ...message, parts } as M) : message;
  });
}

// ==================== APPROVAL SECRET ====================

let processSecret: string | undefined;

/**
 * ASSISTANT_APPROVAL_SECRET signs approval requests. Without it, a random
 * per-process secret is used: approvals still cannot be forged, but a card
 * shown before a server restart can no longer be approved after it.
 */
export function approvalSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ASSISTANT_APPROVAL_SECRET?.trim();
  if (configured) return configured;
  if (!processSecret) {
    processSecret = randomBytes(32).toString('base64');
    console.warn(
      'ASSISTANT_APPROVAL_SECRET is not set; using a per-process secret. Pending approvals will not survive a restart.'
    );
  }
  return processSecret;
}

// ==================== RUN ====================

export type RunAssistantInput = {
  /** Untrusted: the request body's messages. */
  messages: unknown;
  model: LanguageModel;
  provider: AssistantProvider;
  deps: AssistantToolDeps & { timeZone: string; currency: string };
  approvalSecret: string;
  abortSignal?: AbortSignal;
  /**
   * Untrusted: changes the user made on approval cards, by tool call id
   * (see proposalEditsSchema). Checked again on the server before saving.
   */
  proposalEdits?: unknown;
  /** What the user was looking at when the chat was opened (already checked). */
  context?: AskContext | null;
  /** Ids for reply messages. Set it when replies are stored, so ids are stable. */
  generateMessageId?: () => string;
  /** Runs after the history is validated and before the model is called. */
  beforeStream?: (messages: AssistantUIMessage[]) => Promise<void>;
  /** Runs when the reply stream ends, including when it was aborted or the reader went away. */
  onEnd?: (event: {
    responseMessage: AssistantUIMessage;
    /** True when the reply extended the last message (after an approval) instead of adding one. */
    isContinuation: boolean;
    isAborted: boolean;
    /** The model or the stream failed part-way; the reply is incomplete. */
    failed: boolean;
  }) => Promise<void> | void;
};

export type RunAssistantResult =
  | { ok: true; stream: ReturnType<typeof toUIMessageStream> }
  | { ok: false; status: number; error: string };

const FRIENDLY_STREAM_ERROR =
  'Sorry, something went wrong while answering. Please try again.';

export async function runAssistant(input: RunAssistantInput): Promise<RunAssistantResult> {
  const edits = proposalEditsSchema.safeParse(input.proposalEdits ?? {});
  if (!edits.success) {
    return { ok: false, status: 400, error: 'Those changes could not be read. Check the amount and date and try again.' };
  }
  const deps = {
    ...input.deps,
    proposalEdits: new Map(Object.entries(edits.data)),
    // The readReceipt tool reads images with the chat's own model.
    receiptModel: input.deps.receiptModel ?? input.model,
  };
  const tools = buildAssistantTools(deps);

  const validated = await safeValidateUIMessages<AssistantUIMessage>({
    messages: input.messages,
    tools,
  });
  if (!validated.success) {
    console.error('Assistant: invalid messages', validated.error);
    return { ok: false, status: 400, error: 'This conversation could not be read. Start a new chat and try again.' };
  }
  const messages = supersedePendingApprovals(validated.data);
  if (!messages.some((m) => m.role === 'user')) {
    return { ok: false, status: 400, error: 'Send a message first.' };
  }

  const promptContext = await loadPromptContext(input.deps.db, {
    today: input.deps.today,
    timeZone: input.deps.timeZone,
    currency: input.deps.currency,
  });

  await input.beforeStream?.(messages);

  // Set when the model call itself fails. Tool errors do not count: the
  // model reads those and carries on.
  let modelFailed = false;

  const result = streamText({
    model: input.model,
    instructions: buildInstructions(promptContext, input.provider, input.context),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    toolApproval: buildToolApproval(deps),
    experimental_toolApprovalSecret: input.approvalSecret,
    stopWhen: isStepCount(MAX_STEPS),
    providerOptions: providerOptionsFor(input.provider),
    abortSignal: input.abortSignal,
    onError: ({ error }) => {
      modelFailed = true;
      console.error('Assistant stream error:', describeError(error));
    },
  });

  return {
    ok: true,
    stream: toUIMessageStream<AssistantTools, AssistantUIMessage>({
      stream: result.stream,
      tools,
      originalMessages: messages,
      // Tool errors keep the text the model saw, so the history sent back on
      // the next request matches what the model reasoned about. Tools only
      // throw readable messages (lib/assistant/tools.ts); the UI decides
      // whether to show them.
      redactToolErrors: false,
      generateMessageId: input.generateMessageId,
      onEnd: input.onEnd
        ? ({ responseMessage, isContinuation, isAborted, outcome }) =>
            input.onEnd!({
              responseMessage,
              isContinuation,
              isAborted,
              // The stream's own outcome is not enough: a model error part
              // followed by a normal finish is reported as completed.
              failed: modelFailed || outcome.status === 'failed',
            })
        : undefined,
      onError: (error) => {
        console.error('Assistant error:', describeError(error));
        return FRIENDLY_STREAM_ERROR;
      },
    }),
  };
}

/**
 * Error text for the server log. Some SDK errors carry values that crash
 * util.inspect, so never hand the raw object to console.error.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
