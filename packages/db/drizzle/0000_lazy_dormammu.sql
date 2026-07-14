CREATE TABLE "business_events" (
	"seq" bigserial NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"occurred_at" date NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source_system" text NOT NULL,
	"source_document_ref" jsonb,
	"ingested_at" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"bin" text NOT NULL,
	"name" text NOT NULL,
	"oked" jsonb NOT NULL,
	"tax_regime" text NOT NULL,
	"vat_registered" boolean NOT NULL,
	"vat_since" date,
	"reporting_standard" text NOT NULL,
	"accounting_policy" jsonb NOT NULL,
	"employee_count" integer NOT NULL,
	CONSTRAINT "companies_bin_unique" UNIQUE("bin")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"company_id" text NOT NULL,
	"severity" text NOT NULL,
	"as_of" date NOT NULL,
	"exposure_tiyn" bigint NOT NULL,
	"currency" text NOT NULL,
	"message" text NOT NULL,
	"justification" jsonb NOT NULL,
	"remediation" jsonb NOT NULL,
	"first_detected_at" date NOT NULL,
	"resolved_at" date
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"business_event_id" text NOT NULL,
	"date" date NOT NULL,
	"memo" text NOT NULL,
	"lines" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_obligations" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"due_date" date NOT NULL,
	"amount_tiyn" bigint,
	"currency" text,
	"status" text NOT NULL,
	"autonomy_level" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_register_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"business_event_id" text NOT NULL,
	"register" text NOT NULL,
	"period" text NOT NULL,
	"amount_tiyn" bigint NOT NULL,
	"currency" text NOT NULL,
	"norm" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_events" ADD CONSTRAINT "business_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_business_event_id_business_events_id_fk" FOREIGN KEY ("business_event_id") REFERENCES "public"."business_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_register_entries" ADD CONSTRAINT "tax_register_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_register_entries" ADD CONSTRAINT "tax_register_entries_business_event_id_business_events_id_fk" FOREIGN KEY ("business_event_id") REFERENCES "public"."business_events"("id") ON DELETE no action ON UPDATE no action;