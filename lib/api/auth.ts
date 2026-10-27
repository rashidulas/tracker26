import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { errorResponse, fail } from './http';

/** Route context as passed by Next 15 (params is a Promise). */
export type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response;

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    // Still burn a comparison so timing doesn't leak the length check.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Gate a mobile API route behind `Authorization: Bearer <MOBILE_API_TOKEN>`
 * and convert thrown errors into `{ error }` JSON responses.
 */
export function withMobileAuth<C = RouteContext>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const expected = process.env.MOBILE_API_TOKEN?.trim();
    if (!expected) {
      return fail('Mobile API is disabled. Set MOBILE_API_TOKEN on the server.', 503);
    }

    const header = req.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match || !tokensMatch(match[1].trim(), expected)) {
      return fail('Unauthorized', 401);
    }

    try {
      return await handler(req, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
