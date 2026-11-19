/**
 * Which language model the chat assistant uses, from environment variables:
 *
 *   ASSISTANT_PROVIDER  openai (default) | anthropic | google
 *   ASSISTANT_MODEL     model id for that provider (defaults below)
 *
 * API keys: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY
 * (GEMINI_API_KEY also works for google).
 *
 * Receipt scanning (lib/ai/receipts.ts) uses this same model.
 *
 * The model must support tool calling and image input.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, SystemModelMessage } from 'ai';

export type AssistantProvider = 'openai' | 'anthropic' | 'google';

/**
 * Defaults, checked against the provider model lists in November 2026.
 * OpenAI's models page recommends GPT-6.2 Sol for everyday work and agents
 * (tool calling and image input). The others are the providers' balanced
 * tier, used only when ASSISTANT_PROVIDER selects them.
 */
export const DEFAULT_MODELS: Record<AssistantProvider, string> = {
  openai: 'gpt-6.2-sol',
  anthropic: 'claude-sonnet-5-5',
  google: 'gemini-3.5-flash',
};

const KEY_VARS: Record<AssistantProvider, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
};

export type AssistantModelConfig =
  | {
      ok: true;
      provider: AssistantProvider;
      modelId: string;
      model: LanguageModel;
    }
  | { ok: false; error: string };

export function getAssistantModel(env: NodeJS.ProcessEnv = process.env): AssistantModelConfig {
  const raw = (env.ASSISTANT_PROVIDER || 'openai').trim().toLowerCase();
  if (raw !== 'openai' && raw !== 'anthropic' && raw !== 'google') {
    return {
      ok: false,
      error: `ASSISTANT_PROVIDER "${raw}" is not supported. Use openai, anthropic or google.`,
    };
  }
  const provider: AssistantProvider = raw;
  const modelId = env.ASSISTANT_MODEL?.trim() || DEFAULT_MODELS[provider];
  const keyVar = KEY_VARS[provider].find((name) => env[name]?.trim());
  if (!keyVar) {
    return {
      ok: false,
      error: `The assistant is not configured: set ${KEY_VARS[provider][0]} in your .env file.`,
    };
  }
  const apiKey = env[keyVar]!.trim();

  const model =
    provider === 'openai'
      ? createOpenAI({ apiKey })(modelId)
      : provider === 'anthropic'
      ? createAnthropic({ apiKey })(modelId)
      : createGoogle({ apiKey })(modelId);

  return { ok: true, provider, modelId, model };
}

/**
 * The model for the small one-shot calls outside the chat: quick-add text,
 * category suggestions and search filters. The same provider and key as the
 * assistant; ASSISTANT_FAST_MODEL may name a cheaper model id for them.
 * Receipts use the assistant's own model, which is known to read images.
 */
export function getHelperModel(env: NodeJS.ProcessEnv = process.env): AssistantModelConfig {
  const fast = env.ASSISTANT_FAST_MODEL?.trim();
  return getAssistantModel(fast ? { ...env, ASSISTANT_MODEL: fast } : env);
}

/**
 * Provider options that help prompt caching. OpenAI and Google cache a stable
 * prefix automatically; Anthropic needs an explicit breakpoint, which goes on
 * the last stable instruction block (see cacheBreakpoint).
 */
export function providerOptionsFor(provider: AssistantProvider) {
  if (provider === 'openai') {
    return { openai: { promptCacheKey: 'tracker26-assistant' } };
  }
  return undefined;
}

export function cacheBreakpoint(
  provider: AssistantProvider
): Pick<SystemModelMessage, 'providerOptions'> {
  return provider === 'anthropic'
    ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
    : {};
}
