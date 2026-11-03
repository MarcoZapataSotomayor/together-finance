-- This initial migration only accepts an empty application database.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  ) OR EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND t.typtype IN ('e', 'd')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema', 'public')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
  ) THEN
    RAISE EXCEPTION 'Initial migration requires an empty application database. No existing objects will be changed.';
  END IF;
END $$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('PEN');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseClassification" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "DebtOrigin" AS ENUM ('EXPENSE', 'LOAN');

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "owner_person_id" UUID,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'PEN',
    "purchased_on" DATE NOT NULL,
    "merchant" TEXT NOT NULL,
    "description" TEXT,
    "category_id" UUID NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "funded_by_person_id" UUID NOT NULL,
    "classification" "ExpenseClassification" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_allocations" (
    "id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "percentage" DECIMAL(7,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "expense_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debts" (
    "id" UUID NOT NULL,
    "origin" "DebtOrigin" NOT NULL,
    "expense_allocation_id" UUID,
    "debtor_person_id" UUID NOT NULL,
    "creditor_person_id" UUID NOT NULL,
    "original_amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'PEN',
    "incurred_on" DATE NOT NULL,
    "due_on" DATE,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repayments" (
    "id" UUID NOT NULL,
    "debt_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_methods_owner_person_id_idx" ON "payment_methods"("owner_person_id");

-- CreateIndex
CREATE INDEX "expenses_category_id_idx" ON "expenses"("category_id");

-- CreateIndex
CREATE INDEX "expenses_payment_method_id_idx" ON "expenses"("payment_method_id");

-- CreateIndex
CREATE INDEX "expenses_funded_by_person_id_purchased_on_idx" ON "expenses"("funded_by_person_id", "purchased_on");

-- CreateIndex
CREATE INDEX "expenses_deleted_at_purchased_on_idx" ON "expenses"("deleted_at", "purchased_on");

-- CreateIndex
CREATE INDEX "expense_allocations_person_id_idx" ON "expense_allocations"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_allocations_expense_id_person_id_key" ON "expense_allocations"("expense_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "debts_expense_allocation_id_key" ON "debts"("expense_allocation_id");

-- CreateIndex
CREATE INDEX "debts_debtor_person_id_deleted_at_idx" ON "debts"("debtor_person_id", "deleted_at");

-- CreateIndex
CREATE INDEX "debts_creditor_person_id_deleted_at_idx" ON "debts"("creditor_person_id", "deleted_at");

-- CreateIndex
CREATE INDEX "debts_deleted_at_due_on_idx" ON "debts"("deleted_at", "due_on");

-- CreateIndex
CREATE INDEX "repayments_debt_id_deleted_at_idx" ON "repayments"("debt_id", "deleted_at");

-- CreateIndex
CREATE INDEX "repayments_deleted_at_paid_on_idx" ON "repayments"("deleted_at", "paid_on");

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_owner_person_id_fkey" FOREIGN KEY ("owner_person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_funded_by_person_id_fkey" FOREIGN KEY ("funded_by_person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "expense_allocations" ADD CONSTRAINT "expense_allocations_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_expense_allocation_id_fkey" FOREIGN KEY ("expense_allocation_id") REFERENCES "expense_allocations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_debtor_person_id_fkey" FOREIGN KEY ("debtor_person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_creditor_person_id_fkey" FOREIGN KEY ("creditor_person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_debt_id_fkey" FOREIGN KEY ("debt_id") REFERENCES "debts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express these PostgreSQL checks/expression indexes in the schema.
CREATE UNIQUE INDEX "categories_normalized_name_key" ON "categories" (lower(btrim("name")));
ALTER TABLE "people" ADD CONSTRAINT "people_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_merchant_not_blank" CHECK (length(btrim("merchant")) > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive_finite" CHECK ("amount" > 0 AND "amount" <= 999999999999.99);
ALTER TABLE "expense_allocations" ADD CONSTRAINT "allocations_amount_nonnegative_finite" CHECK ("amount" >= 0 AND "amount" <= 999999999999.99);
ALTER TABLE "expense_allocations" ADD CONSTRAINT "allocations_percentage_range" CHECK ("percentage" > 0 AND "percentage" <= 100);
ALTER TABLE "debts" ADD CONSTRAINT "debts_amount_positive_finite" CHECK ("original_amount" > 0 AND "original_amount" <= 999999999999.99);
ALTER TABLE "debts" ADD CONSTRAINT "debts_distinct_counterparties" CHECK ("debtor_person_id" <> "creditor_person_id");
ALTER TABLE "debts" ADD CONSTRAINT "debts_origin_source_consistent" CHECK (
  ("origin" = 'EXPENSE' AND "expense_allocation_id" IS NOT NULL) OR
  ("origin" = 'LOAN' AND "expense_allocation_id" IS NULL)
);
ALTER TABLE "debts" ADD CONSTRAINT "debts_due_date_valid" CHECK ("due_on" IS NULL OR "due_on" >= "incurred_on");
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_amount_positive_finite" CHECK ("amount" > 0 AND "amount" <= 999999999999.99);

COMMIT;
