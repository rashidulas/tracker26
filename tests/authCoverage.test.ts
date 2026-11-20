/**
 * Guards against forgetting the session check.
 *
 * Reads the source: every exported function in every 'use server' file must
 * start with `await requireSession()`, and every API route handler must
 * start with `requireApiSession()`. A new action or route added without the
 * check fails here, whatever the middleware matcher says.
 *
 * Run: npm test (vitest)
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');

/** Sign in and sign out: by definition callable without a session. */
const ACTIONS_WITHOUT_SESSION = ['app/login/actions.ts'];
/** Public by design (lib/auth/gate.ts). The cron routes check CRON_SECRET instead. */
const HEALTH_ROUTE = 'app/api/health/route.ts';
const CRON_ROUTES = [
  'app/api/recurring/run/route.ts',
  'app/api/insights/run/route.ts',
  'app/api/reminders/run/route.ts',
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(relative, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(relative);
  }
  return out;
}

const parse = (file: string) =>
  ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);

const isUseServer = (source: ts.SourceFile) => {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  );
};

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const firstStatement = (fn: ts.FunctionDeclaration, source: ts.SourceFile) =>
  fn.body?.statements[0]?.getText(source).replace(/\s+/g, ' ') ?? '';

const ALL_FILES = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')];

test('every server action starts with requireSession()', () => {
  const actionFiles = ALL_FILES.filter((file) => isUseServer(parse(file)));
  // The scan finds them: a refactor that hides them all would otherwise pass.
  assert.ok(actionFiles.length >= 15, `found only ${actionFiles.length} 'use server' files`);
  for (const file of ACTIONS_WITHOUT_SESSION) assert.ok(actionFiles.includes(file), `${file} is missing`);

  let checked = 0;
  const problems: string[] = [];
  for (const file of actionFiles) {
    if (ACTIONS_WITHOUT_SESSION.includes(file)) continue;
    const source = parse(file);
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
        checked += 1;
        if (firstStatement(statement, source) !== 'await requireSession();') {
          problems.push(`${file}: ${statement.name?.text ?? '(default)'} does not start with await requireSession()`);
        }
      } else if (ts.isVariableStatement(statement) && isExported(statement)) {
        // An action written as `export const x = async () => ...` would slip past the check above.
        problems.push(`${file}: export actions as "export async function" so the session check can be verified`);
      } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        problems.push(`${file}: re-exports are not checked; declare the action here`);
      } else if (ts.isExportAssignment(statement)) {
        problems.push(`${file}: default export expressions are not checked`);
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(checked >= 79, `checked only ${checked} actions`);
});

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

test('every API route handler checks the session first', () => {
  const routes = ALL_FILES.filter((file) => /^app\/api\/.*\/route\.ts$/.test(file));
  assert.ok(routes.length >= 9, `found only ${routes.length} routes`);

  const problems: string[] = [];
  let checked = 0;
  for (const file of routes) {
    if (file === HEALTH_ROUTE) continue;
    const source = parse(file);
    const text = source.getFullText();

    if (CRON_ROUTES.includes(file)) {
      // Not behind the login: the bearer secret is their check.
      if (!/if \(!authorized\(request\)\) \{\s*return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);/.test(text)) {
        problems.push(`${file}: the CRON_SECRET check is missing`);
      }
      if (!text.includes('timingSafeEqual')) problems.push(`${file}: the secret must be compared in constant time`);
      continue;
    }

    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && isExported(statement) && HTTP_METHODS.has(statement.name?.text ?? '')) {
        checked += 1;
        if (firstStatement(statement, source) !== 'const denied = await requireApiSession();') {
          problems.push(`${file}: ${statement.name!.text} does not start with requireApiSession()`);
        }
        const second = statement.body?.statements[1]?.getText(source).replace(/\s+/g, ' ');
        if (second !== 'if (denied) return denied;') {
          problems.push(`${file}: ${statement.name!.text} does not return the denial`);
        }
      } else if (ts.isVariableStatement(statement) && isExported(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (HTTP_METHODS.has(declaration.name.getText(source))) {
            problems.push(`${file}: write ${declaration.name.getText(source)} as "export async function" so its session check can be verified`);
          }
        }
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(checked >= 8, `checked only ${checked} handlers`);
});

test('pages that read the database directly check the session', () => {
  // Pages normally load through server actions (checked above). These read
  // through lib/ instead, so they carry their own check.
  const direct = ['app/(home)/page.tsx', 'app/chat/[[...id]]/page.tsx', 'app/(home)/insights/data.ts'];
  for (const file of direct) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /await requireSession\(\);/, file);
  }
  // Any other page or layout importing the database client must be added above.
  const importsPrisma = ALL_FILES.filter(
    (file) =>
      /^app\/.*\/(page|layout)\.tsx$/.test(file) &&
      /from ['"]@\/lib\/prisma['"]/.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))
  );
  for (const file of importsPrisma) assert.ok(direct.includes(file), `${file} reads the database without a listed session check`);
});
