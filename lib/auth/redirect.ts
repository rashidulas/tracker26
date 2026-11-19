/**
 * Where to go after signing in. The target arrives in the query string, so it
 * is untrusted: only a path on this site is accepted, anything else becomes "/".
 */
const FALLBACK = '/';

export function safeRedirectTarget(target: unknown): string {
  if (typeof target !== 'string' || target.length === 0 || target.length > 2000) return FALLBACK;
  // A single leading slash: "//host" and "/\host" are other sites to a browser.
  if (!target.startsWith('/') || target.startsWith('//')) return FALLBACK;
  if (target.includes('\\')) return FALLBACK;
  // Control characters (tabs and newlines are stripped by URL parsers, which
  // would turn "/\t/host" into "//host").
  if (/[\u0000-\u001f\u007f]/.test(target)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(target, 'http://internal.invalid');
  } catch {
    return FALLBACK;
  }
  if (url.origin !== 'http://internal.invalid') return FALLBACK;
  const path = url.pathname;
  // Not back to the login page, and not to an endpoint.
  if (path === '/login' || path.startsWith('/login/') || path === '/api' || path.startsWith('/api/')) {
    return FALLBACK;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
