export type PaymentStatus = "requires_confirmation" | "processing" | "succeeded" | "failed" | "canceled";

export interface Operator {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  customerId: string;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  providerChargeId: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  amountCents: number;
  status: "pending" | "succeeded" | "failed";
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  paymentId: string;
  refundId: string | null;
  account: string;
  direction: "debit" | "credit";
  amountCents: number;
  currency: string;
  createdAt: string;
}

export interface PaymentEvent {
  id: string;
  paymentId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderEvent {
  eventId: string;
  type: string;
  processedAt: string;
}

export interface IdempotencyRecord {
  key: string;
  operatorId: string;
  path: string;
  requestHash: string;
  status: number;
  body: unknown;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DbShape {
  operators: Operator[];
  customers: Customer[];
  payments: Payment[];
  refunds: Refund[];
  ledger: LedgerEntry[];
  events: PaymentEvent[];
  providerEvents: ProviderEvent[];
  idempotency: IdempotencyRecord[];
  audit: AuditEntry[];
}

export const emptyDb = (): DbShape => ({
  operators: [],
  customers: [],
  payments: [],
  refunds: [],
  ledger: [],
  events: [],
  providerEvents: [],
  idempotency: [],
  audit: [],
});

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
