/**
 * Double-entry ledger book — builds balanced journal lines and checks invariants.
 */

export type LedgerDirection = "debit" | "credit";

export type LedgerLine = {
  account: string;
  direction: LedgerDirection;
  amountCents: number;
  currency: string;
};

export type JournalEntry = {
  paymentId: string;
  refundId: string | null;
  operatorId: string;
  lines: [LedgerLine, LedgerLine];
};

export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerInvariantError";
  }
}

/** Capture: funds leave processor clearing into merchant receivable. */
export function captureJournal(
  paymentId: string,
  operatorId: string,
  amountCents: number,
  currency: string,
): JournalEntry {
  assertPositive(amountCents);
  return {
    paymentId,
    refundId: null,
    operatorId,
    lines: [
      { account: "processor_clearing", direction: "debit", amountCents, currency },
      { account: "merchant_receivable", direction: "credit", amountCents, currency },
    ],
  };
}

/** Refund: reverse the capture pair. */
export function refundJournal(
  paymentId: string,
  refundId: string,
  operatorId: string,
  amountCents: number,
  currency: string,
): JournalEntry {
  assertPositive(amountCents);
  return {
    paymentId,
    refundId,
    operatorId,
    lines: [
      { account: "merchant_receivable", direction: "debit", amountCents, currency },
      { account: "processor_clearing", direction: "credit", amountCents, currency },
    ],
  };
}

export function assertEntryBalanced(entry: JournalEntry): void {
  const debit = entry.lines.filter((l) => l.direction === "debit").reduce((s, l) => s + l.amountCents, 0);
  const credit = entry.lines.filter((l) => l.direction === "credit").reduce((s, l) => s + l.amountCents, 0);
  if (debit !== credit) {
    throw new LedgerInvariantError(
      `Unbalanced journal for payment ${entry.paymentId}: debit=${debit} credit=${credit}`,
    );
  }
}

export function assertTotalsBalanced(
  paymentId: string,
  rows: Array<{ direction: LedgerDirection; amountCents: number }>,
): void {
  const debit = rows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amountCents, 0);
  const credit = rows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amountCents, 0);
  if (debit !== credit) {
    throw new LedgerInvariantError(
      `Ledger imbalance for payment ${paymentId}: debit=${debit} credit=${credit}`,
    );
  }
}

function assertPositive(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new LedgerInvariantError("Ledger amounts must be positive integers");
  }
}
