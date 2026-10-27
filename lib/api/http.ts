import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { z, type ZodTypeAny } from 'zod';

/** Error that maps directly to an HTTP `{ error }` response. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function notFound(what = 'Resource'): never {
  throw new ApiError(`${what} not found`, 404);
}

function firstZodMessage(error: z.ZodError): string {
  const issue = error.errors[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  // Zod's default messages ("Required", "Expected number, received string",
  // "Invalid enum value...") are useless without the field name; custom
  // messages already read well.
  const isDefault =
    issue.message === 'Required' ||
    issue.message.startsWith('Expected ') ||
    issue.message.startsWith('Invalid enum value');
  if (path && isDefault) {
    return `${path}: ${issue.message}`;
  }
  return issue.message;
}

/** Validate an arbitrary value; throws a 400 ApiError with the first zod message. */
export function parseWith<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(firstZodMessage(result.error), 400);
  return result.data;
}

/** Parse + validate a JSON request body. */
export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError('Request body must be valid JSON', 400);
  }
  return parseWith(schema, body);
}

/** Validate URL search params (as a plain object of strings). */
export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return parseWith(schema, params);
}

/** Convert any thrown error into an `{ error }` response. */
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return fail(error.message, error.status);

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2025':
        return fail('Not found', 404);
      case 'P2023':
        return fail('Invalid id', 400);
      case 'P2002':
        return fail('A record with that value already exists', 409);
      case 'P2003':
      case 'P2014':
        return fail('This record is still referenced by other data', 409);
    }
  }

  console.error('[api/v1] Unhandled error:', error);
  const message = error instanceof Error ? error.message : 'Internal server error';
  return fail(message || 'Internal server error', 500);
}

/** Refresh the web pages that show the mutated data. Never throws. */
export function revalidateWeb(...paths: string[]) {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error) {
      console.warn(`[api/v1] revalidatePath(${path}) failed:`, error);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared zod building blocks
// ---------------------------------------------------------------------------

const emptyToNull = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return value;
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const objectId = (label = 'Record') =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
    .regex(OBJECT_ID, `Invalid ${label.toLowerCase()} id`);

/** Required id; `null` / `""` count as missing. */
export const requiredId = (label: string) => z.preprocess(emptyToNull, objectId(label));

/** Optional id; `null`, `""` and omitted all become `null`. */
export const optionalId = (label: string) =>
  z.preprocess(emptyToNull, objectId(label).nullable().optional()).transform((v) => v ?? null);

/** Optional free-text; trimmed, `""` / omitted become `null`. */
export const optionalString = (max?: number) =>
  z
    .preprocess(emptyToNull, (max ? z.string().max(max) : z.string()).nullable().optional())
    .transform((v) => v ?? null);

export const requiredString = (label: string, max?: number) => {
  let s = z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`);
  if (max) s = s.max(max, `${label} must be at most ${max} characters`);
  return s;
};

export const dateString = z
  .string({ required_error: 'Date is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(v).getTime()) && new Date(v).toISOString().startsWith(v), 'Invalid date');

export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM');

export const positiveAmount = (label = 'Amount') =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .finite()
    .positive(`${label} must be positive`);

export const tagsSchema = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((tags) => (tags ?? []).map((t) => t.trim()).filter(Boolean));

/** Validate a route `:id` param; malformed ids are a 404 rather than a Prisma crash. */
export function assertId(id: string, what = 'Resource'): string {
  if (!OBJECT_ID.test(id)) notFound(what);
  return id;
}
