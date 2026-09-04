/**
 * Payment intent state machine — pure transitions, no I/O.
 *
 * requires_confirmation → processing | canceled
 * processing → succeeded | failed
 * succeeded → (refunds are separate; status stays succeeded)
 * failed | canceled → terminal
 */

export type PaymentStatus =
  | "requires_confirmation"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type PaymentCommand = "confirm" | "cancel" | "provider_succeeded" | "provider_failed";

export type TransitionResult =
  | { ok: true; next: PaymentStatus; idempotent: boolean }
  | { ok: false; status: 400 | 409; message: string };

const TERMINAL: ReadonlySet<PaymentStatus> = new Set(["succeeded", "failed", "canceled"]);

export function transition(current: PaymentStatus, command: PaymentCommand): TransitionResult {
  switch (command) {
    case "confirm": {
      if (current === "processing" || current === "succeeded") {
        return { ok: true, next: current, idempotent: true };
      }
      if (current !== "requires_confirmation") {
        return { ok: false, status: 409, message: `Cannot confirm payment in status ${current}` };
      }
      return { ok: true, next: "processing", idempotent: false };
    }
    case "cancel": {
      if (current === "canceled") {
        return { ok: true, next: "canceled", idempotent: true };
      }
      if (current !== "requires_confirmation") {
        return { ok: false, status: 409, message: `Cannot cancel payment in status ${current}` };
      }
      return { ok: true, next: "canceled", idempotent: false };
    }
    case "provider_succeeded": {
      if (TERMINAL.has(current) && current !== "processing") {
        return { ok: true, next: current, idempotent: true };
      }
      if (current !== "processing") {
        return { ok: false, status: 409, message: `Unexpected status ${current} for provider event` };
      }
      return { ok: true, next: "succeeded", idempotent: false };
    }
    case "provider_failed": {
      if (TERMINAL.has(current) && current !== "processing") {
        return { ok: true, next: current, idempotent: true };
      }
      if (current !== "processing") {
        return { ok: false, status: 409, message: `Unexpected status ${current} for provider event` };
      }
      return { ok: true, next: "failed", idempotent: false };
    }
    default: {
      const _exhaustive: never = command;
      return { ok: false, status: 409, message: `Unknown command ${_exhaustive}` };
    }
  }
}

export function canRefund(status: PaymentStatus): TransitionResult {
  if (status !== "succeeded") {
    return { ok: false, status: 409, message: "Only succeeded payments can be refunded" };
  }
  return { ok: true, next: "succeeded", idempotent: false };
}

export function assertRefundAmount(paymentCents: number, alreadyRefunded: number, requestCents: number): TransitionResult {
  if (requestCents <= 0) {
    return { ok: false, status: 400, message: "Refund amount must be positive" };
  }
  if (requestCents + alreadyRefunded > paymentCents) {
    return { ok: false, status: 400, message: "Refund exceeds captured amount" };
  }
  return { ok: true, next: "succeeded", idempotent: false };
}
