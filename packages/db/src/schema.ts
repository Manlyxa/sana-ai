import {
  bigint,
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

/**
 * Схема Postgres 16. Деньги — bigint тиын + валюта (никаких numeric/float),
 * деловые даты — date (календарные даты Алматы), периоды — коды
 * TaxPeriod («2026-Q1»). Статусные словари хранятся как text: их источник
 * истины — типы домена, а не БД.
 */

export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  bin: text('bin').notNull().unique(),
  name: text('name').notNull(),
  oked: jsonb('oked').$type<string[]>().notNull(),
  taxRegime: text('tax_regime').notNull(),
  vatRegistered: boolean('vat_registered').notNull(),
  vatSince: date('vat_since'),
  reportingStandard: text('reporting_standard').notNull(),
  accountingPolicy: jsonb('accounting_policy').$type<Record<string, unknown>>().notNull(),
  employeeCount: integer('employee_count').notNull(),
});

/** Теневой регистр (P8): только INSERT, никогда UPDATE/DELETE. */
export const businessEvents = pgTable('business_events', {
  seq: bigserial('seq', { mode: 'bigint' }).notNull(),
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  occurredAt: date('occurred_at').notNull(),
  type: text('type').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  sourceSystem: text('source_system').notNull(),
  sourceDocumentRef: jsonb('source_document_ref').$type<unknown>(),
  ingestedAt: date('ingested_at').notNull(),
});

export const journalEntries = pgTable('journal_entries', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  businessEventId: text('business_event_id')
    .notNull()
    .references(() => businessEvents.id),
  date: date('date').notNull(),
  memo: text('memo').notNull(),
  lines: jsonb('lines').$type<unknown>().notNull(),
});

export const taxRegisterEntries = pgTable('tax_register_entries', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  businessEventId: text('business_event_id')
    .notNull()
    .references(() => businessEvents.id),
  register: text('register').notNull(),
  period: text('period').notNull(),
  amountTiyn: bigint('amount_tiyn', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  norm: text('norm').notNull(),
});

export const taxObligations = pgTable('tax_obligations', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  kind: text('kind').notNull(),
  period: text('period').notNull(),
  dueDate: date('due_date').notNull(),
  amountTiyn: bigint('amount_tiyn', { mode: 'bigint' }),
  currency: text('currency'),
  status: text('status').notNull(),
  autonomyLevel: text('autonomy_level').notNull(),
});

export const findings = pgTable('findings', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').notNull(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  severity: text('severity').notNull(),
  asOf: date('as_of').notNull(),
  exposureTiyn: bigint('exposure_tiyn', { mode: 'bigint' }).notNull(),
  currency: text('currency').notNull(),
  message: text('message').notNull(),
  justification: jsonb('justification').$type<unknown>().notNull(),
  remediation: jsonb('remediation').$type<unknown>().notNull(),
  firstDetectedAt: date('first_detected_at').notNull(),
  resolvedAt: date('resolved_at'),
});
