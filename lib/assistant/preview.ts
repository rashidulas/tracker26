/**
 * What an approval card shows for one proposed change.
 *
 * The server builds a preview by actually running the change inside a
 * database transaction that is then rolled back (lib/assistant/actions.ts),
 * so the card describes exactly what approving will do: which records, the
 * values before and after, and how many are affected.
 *
 * The preview travels to the browser as the approval request's reason, as
 * JSON. The AI SDK does not send that reason to the model. Safe for client code.
 */

/** Which input a field is edited with on the card. */
export type EditControl =
  | 'amount'
  | 'date'
  | 'month'
  | 'text'
  | 'expenseCategory'
  | 'incomeCategory'
  | 'account';

export type PreviewField = {
  label: string;
  /** The value after the change, as text. */
  value: string;
  /** The value before the change, when this field changes. */
  was?: string;
  /**
   * Present when the user may change this value before approving. `key` is
   * the path in the tool's input ("amount", "items.2.categoryId").
   */
  edit?: { key: string; control: EditControl; value: string | number | null };
};

export type PreviewItem = {
  /** One line naming the record, e.g. "Expense $25.50 at Chipotle". */
  title: string;
  /** add: created. change: edited. remove: deleted. */
  tone: 'add' | 'change' | 'remove';
  fields: PreviewField[];
};

export type ProposalPreview = {
  v: 1;
  /** What approving will do: "Delete 2 transactions". */
  heading: string;
  /** The same once done: "Deleted 2 transactions". */
  done: string;
  /** One line for the conversation history. */
  summary: string;
  /** Deletes or changes several existing records. The card warns and counts. */
  destructive: boolean;
  /** Records created, changed or deleted. */
  count: number;
  items: PreviewItem[];
  /** Extra consequence worth spelling out, e.g. linked records that go too. */
  warning?: string;
  /** Where to look at the result afterwards. */
  link?: { href: string; label: string };
};

/** Values the user changed on a card, by field key. */
export type FieldEdits = Record<string, string | number | null>;

export function encodePreview(preview: ProposalPreview): string {
  return JSON.stringify(preview);
}

/** The preview carried by an approval reason, or null if it is plain text. */
export function decodePreview(reason: string | undefined | null): ProposalPreview | null {
  if (!reason || reason[0] !== '{') return null;
  try {
    const parsed = JSON.parse(reason) as ProposalPreview;
    return parsed && parsed.v === 1 && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}
