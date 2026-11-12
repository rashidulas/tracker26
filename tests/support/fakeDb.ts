/**
 * In-memory stand-in for the subset of PrismaClient that lib/transactions.ts
 * and lib/references.ts use. Enough to check balances without a database.
 *
 * - $transaction(fn) snapshots all data and restores it if fn throws.
 * - Writes made outside $transaction throw, so a test fails if the module
 *   ever writes without a transaction.
 */
type Doc = Record<string, any>;
type Where = Record<string, any> | undefined;

const MODELS = [
  'account',
  'category',
  'subcategory',
  'transaction',
  'goalContribution',
  'budget',
] as const;
type ModelName = (typeof MODELS)[number];

const DEFAULTS: Record<ModelName, Doc> = {
  account: { institution: null, startingBalance: 0, creditLimit: null },
  category: { icon: null },
  subcategory: {},
  transaction: {
    categoryId: null,
    subcategoryId: null,
    accountId: null,
    toAccountId: null,
    merchantOrSource: null,
    notes: null,
    tags: [],
    splitItems: [],
    accountSplits: [],
    splitGroupId: null,
  },
  goalContribution: { notes: null },
  budget: {},
};

let counter = 0;
export function newId() {
  counter += 1;
  return counter.toString(16).padStart(24, '0');
}

const clone = <T>(v: T): T => structuredClone(v);

function eq(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

export function matches(doc: Doc, where: Where): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === 'OR') {
      if (!(cond as Where[]).some((w) => matches(doc, w))) return false;
      continue;
    }
    if (key === 'AND') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((w: Where) => matches(doc, w))) return false;
      continue;
    }
    if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((w: Where) => matches(doc, w))) return false;
      continue;
    }
    if (key === 'name_type') {
      if (!matches(doc, cond)) return false;
      continue;
    }

    const value = doc[key];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      if (!eq(value, cond)) return false;
      continue;
    }
    if ('equals' in cond && !eq(value, cond.equals)) return false;
    if ('in' in cond && !cond.in.some((c: unknown) => eq(value, c))) return false;
    if ('not' in cond) {
      if (cond.not !== null && typeof cond.not === 'object' && !(cond.not instanceof Date)) {
        if (matches(doc, { [key]: cond.not })) return false;
      } else if (eq(value, cond.not)) return false;
    }
    if ('has' in cond && !(value || []).includes(cond.has)) return false;
    if ('some' in cond && !(value || []).some((item: Doc) => matches(item, cond.some))) {
      return false;
    }
    if ('gte' in cond && !(value >= cond.gte)) return false;
    if ('lte' in cond && !(value <= cond.lte)) return false;
  }
  return true;
}

function project(doc: Doc, select?: Record<string, boolean>) {
  if (!select) return clone(doc);
  const out: Doc = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = clone(doc[k]);
  return out;
}

export class FakeDb {
  data: Record<ModelName, Doc[]> = {
    account: [],
    category: [],
    subcategory: [],
    transaction: [],
    goalContribution: [],
    budget: [],
  };
  private inTransaction = false;
  /** Number of $transaction calls that committed. */
  commits = 0;

  private guardWrite(model: string, op: string) {
    if (!this.inTransaction) {
      throw new Error(`FakeDb: ${model}.${op} called outside $transaction`);
    }
  }

  private model(name: ModelName) {
    const rows = () => this.data[name];
    const self = this;
    return {
      findUnique: async ({ where, select }: { where: Where; select?: any }) => {
        const doc = rows().find((d) => matches(d, where));
        return doc ? project(doc, select) : null;
      },
      findFirst: async ({ where, select }: { where?: Where; select?: any } = {}) => {
        const doc = rows().find((d) => matches(d, where));
        return doc ? project(doc, select) : null;
      },
      findMany: async ({ where, select }: { where?: Where; select?: any } = {}) =>
        rows()
          .filter((d) => matches(d, where))
          .map((d) => project(d, select)),
      count: async ({ where }: { where?: Where } = {}) =>
        rows().filter((d) => matches(d, where)).length,
      create: async ({ data, select }: { data: Doc; select?: any }) => {
        self.guardWrite(name, 'create');
        const now = new Date();
        const doc = {
          ...clone(DEFAULTS[name]),
          id: newId(),
          createdAt: now,
          updatedAt: now,
          ...clone(data),
        };
        rows().push(doc);
        return project(doc, select);
      },
      update: async ({ where, data, select }: { where: Where; data: Doc; select?: any }) => {
        self.guardWrite(name, 'update');
        const doc = rows().find((d) => matches(d, where));
        if (!doc) throw new Error(`FakeDb: ${name}.update record not found`);
        Object.assign(doc, clone(data), { updatedAt: new Date() });
        return project(doc, select);
      },
      updateMany: async ({ where, data }: { where?: Where; data: Doc }) => {
        self.guardWrite(name, 'updateMany');
        const hit = rows().filter((d) => matches(d, where));
        for (const doc of hit) Object.assign(doc, clone(data));
        return { count: hit.length };
      },
      upsert: async ({ where, create, update, select }: any) => {
        self.guardWrite(name, 'upsert');
        const doc = rows().find((d) => matches(d, where));
        if (doc) {
          Object.assign(doc, clone(update));
          return project(doc, select);
        }
        const created = { ...clone(DEFAULTS[name]), id: newId(), ...clone(create) };
        rows().push(created);
        return project(created, select);
      },
      delete: async ({ where }: { where: Where }) => {
        self.guardWrite(name, 'delete');
        const idx = rows().findIndex((d) => matches(d, where));
        if (idx < 0) throw new Error(`FakeDb: ${name}.delete record not found`);
        return rows().splice(idx, 1)[0];
      },
      deleteMany: async ({ where }: { where?: Where } = {}) => {
        self.guardWrite(name, 'deleteMany');
        const keep = rows().filter((d) => !matches(d, where));
        const count = rows().length - keep.length;
        this.data[name] = keep;
        return { count };
      },
    };
  }

  account = this.model('account');
  category = this.model('category');
  subcategory = this.model('subcategory');
  transaction = this.model('transaction');
  goalContribution = this.model('goalContribution');
  budget = this.model('budget');

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    if (this.inTransaction) throw new Error('FakeDb: nested $transaction');
    const snapshot = clone(this.data);
    this.inTransaction = true;
    try {
      const result = await fn(this);
      this.commits += 1;
      return result;
    } catch (error) {
      this.data = snapshot;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  /** Test setup: insert rows directly (bypasses the transaction guard). */
  seed(name: ModelName, data: Doc): Doc {
    const doc = { ...clone(DEFAULTS[name]), id: newId(), ...clone(data) };
    this.data[name].push(doc);
    return doc;
  }
}
