import bcrypt from "bcryptjs";
import { PrismaClient, PaymentStatus, LedgerDirection } from "@prisma/client";

const DEMO_EMAIL = "demo@ledger.app";
const DEMO_PASSWORD = "LedgerDemo123!";

const prisma = new PrismaClient();

async function postLedger(
  paymentId: string,
  refundId: string | null,
  operatorId: string,
  amountCents: number,
  currency: string,
  debit: string,
  credit: string,
  createdAt: Date,
) {
  await prisma.ledgerEntry.createMany({
    data: [
      { paymentId, refundId, operatorId, account: debit, direction: LedgerDirection.debit, amountCents, currency, createdAt },
      { paymentId, refundId, operatorId, account: credit, direction: LedgerDirection.credit, amountCents, currency, createdAt },
    ],
  });
}

async function audit(
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: { actorId, action, resourceType, resourceId, metadata },
  });
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    console.log("Demo operator already seeded:", DEMO_EMAIL);
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const operator = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  const acme = await prisma.customer.create({
    data: { operatorId: operator.id, email: "billing@acme-metals.test", name: "Acme Metals" },
  });
  const northwind = await prisma.customer.create({
    data: { operatorId: operator.id, email: "ap@northwind.test", name: "Northwind Retail" },
  });

  const succeeded = await prisma.payment.create({
    data: {
      operatorId: operator.id,
      customerId: acme.id,
      amountCents: 5000,
      currency: "usd",
      status: PaymentStatus.succeeded,
      providerChargeId: "ch_demo_succeeded_acme50",
      description: "Wire-cut invoice #4412",
    },
  });
  const processing = await prisma.payment.create({
    data: {
      operatorId: operator.id,
      customerId: northwind.id,
      amountCents: 12800,
      currency: "usd",
      status: PaymentStatus.processing,
      providerChargeId: "ch_demo_processing_nw128",
      description: "Seasonal restock",
    },
  });
  const pending = await prisma.payment.create({
    data: {
      operatorId: operator.id,
      customerId: acme.id,
      amountCents: 2500,
      currency: "usd",
      status: PaymentStatus.requires_confirmation,
      description: "Sample-lot hold",
    },
  });

  await prisma.paymentEvent.createMany({
    data: [
      { paymentId: succeeded.id, type: "payment.created", data: { amountCents: 5000 } },
      { paymentId: succeeded.id, type: "payment.processing", data: { providerChargeId: succeeded.providerChargeId } },
      { paymentId: succeeded.id, type: "payment.succeeded", data: {} },
      { paymentId: processing.id, type: "payment.created", data: { amountCents: 12800 } },
      { paymentId: processing.id, type: "payment.processing", data: { providerChargeId: processing.providerChargeId } },
      { paymentId: pending.id, type: "payment.created", data: { amountCents: 2500 } },
    ],
  });

  await postLedger(succeeded.id, null, operator.id, 5000, "usd", "processor_clearing", "merchant_receivable", new Date());

  const refund = await prisma.refund.create({
    data: {
      operatorId: operator.id,
      paymentId: succeeded.id,
      amountCents: 1500,
      status: "succeeded",
    },
  });
  await prisma.paymentEvent.create({
    data: { paymentId: succeeded.id, type: "refund.succeeded", data: { refundId: refund.id, amountCents: 1500 } },
  });
  await postLedger(succeeded.id, refund.id, operator.id, 1500, "usd", "merchant_receivable", "processor_clearing", new Date());

  await prisma.webhookEvent.create({
    data: {
      eventId: "evt_demo_charge_succeeded_4412",
      type: "charge.succeeded",
      payload: { providerChargeId: succeeded.providerChargeId },
      processedAt: new Date(),
    },
  });

  await audit(operator.id, "user.registered", "user", operator.id, { seeded: true });
  await audit(operator.id, "payment.created", "payment", succeeded.id, { amountCents: 5000 });
  await audit(operator.id, "payment.confirmed", "payment", succeeded.id, { providerChargeId: succeeded.providerChargeId });
  await audit(null, "charge.succeeded", "payment", succeeded.id, { eventId: "evt_demo_charge_succeeded_4412" });
  await audit(operator.id, "refund.created", "refund", refund.id, { paymentId: succeeded.id, amountCents: 1500 });
  await audit(operator.id, "payment.created", "payment", processing.id, { amountCents: 12800 });
  await audit(operator.id, "payment.created", "payment", pending.id, { amountCents: 2500 });

  console.log("Seeded demo operator", DEMO_EMAIL);
  console.log("Customers: Acme Metals, Northwind Retail");
  console.log("Payments: 1 succeeded (+refund), 1 processing, 1 requires_confirmation");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
