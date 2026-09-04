import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertEntryBalanced,
  assertTotalsBalanced,
  captureJournal,
  LedgerInvariantError,
  refundJournal,
} from "../src/domain/ledger-book.js";
import { assertRefundAmount, canRefund, transition } from "../src/domain/payment-machine.js";

test("payment machine: confirm / cancel / settle", () => {
  assert.equal(transition("requires_confirmation", "confirm").ok, true);
  assert.equal(transition("requires_confirmation", "cancel").ok, true);
  assert.equal(transition("processing", "cancel").ok, false);
  assert.equal(transition("processing", "provider_succeeded").ok, true);
  assert.equal(transition("processing", "provider_failed").ok, true);

  const confirmAgain = transition("processing", "confirm");
  assert.equal(confirmAgain.ok, true);
  if (confirmAgain.ok) assert.equal(confirmAgain.idempotent, true);

  const settleTerminal = transition("succeeded", "provider_succeeded");
  assert.equal(settleTerminal.ok, true);
  if (settleTerminal.ok) assert.equal(settleTerminal.idempotent, true);
});

test("payment machine: refund gates", () => {
  assert.equal(canRefund("processing").ok, false);
  assert.equal(canRefund("succeeded").ok, true);

  const over = assertRefundAmount(1000, 600, 500);
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.status, 400);

  const ok = assertRefundAmount(1000, 600, 400);
  assert.equal(ok.ok, true);
});

test("ledger book: capture and refund journals balance", () => {
  const capture = captureJournal("pay_1", "op_1", 2000, "usd");
  assertEntryBalanced(capture);
  assert.equal(capture.lines[0].account, "processor_clearing");
  assert.equal(capture.lines[1].direction, "credit");

  const refund = refundJournal("pay_1", "rf_1", "op_1", 500, "usd");
  assertEntryBalanced(refund);

  assertTotalsBalanced("pay_1", [
    { direction: "debit", amountCents: 2000 },
    { direction: "credit", amountCents: 2000 },
    { direction: "debit", amountCents: 500 },
    { direction: "credit", amountCents: 500 },
  ]);

  assert.throws(
    () => assertTotalsBalanced("pay_1", [{ direction: "debit", amountCents: 10 }, { direction: "credit", amountCents: 9 }]),
    LedgerInvariantError,
  );
});
