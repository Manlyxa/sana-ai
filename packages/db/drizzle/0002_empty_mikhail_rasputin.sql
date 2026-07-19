CREATE TABLE "ledger_entries" (
	"seq" bigserial NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"date" date NOT NULL,
	"memo" text NOT NULL,
	"lines" jsonb NOT NULL,
	"counterparty_bin" text,
	"counterparty_name" text,
	"category" text,
	"norm" text,
	"legal_params_version" text NOT NULL,
	"reverses_entry_id" text
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;