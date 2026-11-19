/**
 * npm run auth:hash
 *
 * Asks for the password you want to sign in with (typed twice, not shown)
 * and prints the two lines to put in the environment:
 *
 *   AUTH_PASSWORD_HASH  a bcrypt hash of the password, base64-encoded so the
 *                       "$" characters in it survive .env files (Next.js
 *                       expands "$..." there)
 *   AUTH_SECRET         a fresh random secret for the session cookie
 *
 * Nothing is written to disk and the password itself is never printed.
 * Keep your existing AUTH_SECRET if you are only changing the password and
 * do not want to be signed out everywhere.
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import bcrypt from 'bcryptjs';

const COST = 12;
const MIN_LENGTH = 10;

function ask(question, { hidden }) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) {
      // Show the question, then swallow the echo of what is typed.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden && process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPiped() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text.split(/\r?\n/)[0];
}

async function main() {
  let password;
  if (process.stdin.isTTY) {
    password = await ask('New password: ', { hidden: true });
    const again = await ask('Repeat it: ', { hidden: true });
    if (password !== again) {
      console.error('The two entries did not match. Nothing was generated.');
      process.exit(1);
    }
  } else {
    // Piped in, e.g. from a password manager's CLI.
    password = await readPiped();
  }

  if (password.length < MIN_LENGTH) {
    console.error(`Use at least ${MIN_LENGTH} characters. Nothing was generated.`);
    process.exit(1);
  }
  if (bcrypt.truncates(password)) {
    console.error('That is longer than bcrypt can use (72 bytes). Use a shorter password.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, COST);
  const encoded = Buffer.from(hash, 'utf8').toString('base64');
  const secret = randomBytes(32).toString('base64url');

  console.log('\nAdd these to .env.local and to your host\'s environment variables:\n');
  console.log(`AUTH_PASSWORD_HASH="${encoded}"`);
  console.log(`AUTH_SECRET="${secret}"`);
  console.log(
    '\nAUTH_SECRET signs the session cookie. Changing it signs every device out;\n' +
      'keep the one you already have if you are only changing the password.'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
