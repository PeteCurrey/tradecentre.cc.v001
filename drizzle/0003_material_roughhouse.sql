CREATE TYPE "public"."arm_state" AS ENUM('disarmed', 'armed', 'halted');--> statement-breakpoint
CREATE TYPE "public"."order_outcome" AS ENUM('rejected_by_guard', 'dry_run', 'submitted', 'filled', 'broker_rejected', 'error');--> statement-breakpoint
CREATE TABLE "execution_state" (
	"book" "book" PRIMARY KEY NOT NULL,
	"state" "arm_state" DEFAULT 'disarmed' NOT NULL,
	"allow_live_capital" boolean DEFAULT false NOT NULL,
	"instrument_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_open_positions" smallint DEFAULT 2 NOT NULL,
	"max_risk_multiple" numeric(5, 2) DEFAULT '1.50' NOT NULL,
	"enabled_pattern_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"halted_reason" text,
	"armed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"book" "book" NOT NULL,
	"pattern_id" integer,
	"instrument" text NOT NULL,
	"direction" "direction" NOT NULL,
	"units" numeric(20, 6) NOT NULL,
	"requested_stop" numeric(20, 8),
	"requested_target" numeric(20, 8),
	"intended_risk" numeric(20, 6),
	"outcome" "order_outcome" NOT NULL,
	"rejected_by" text,
	"reason" text,
	"oanda_order_id" text,
	"oanda_trade_id" text,
	"request" jsonb,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_log" ADD CONSTRAINT "order_log_pattern_id_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."patterns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_log_created_idx" ON "order_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_log_book_idx" ON "order_log" USING btree ("book");--> statement-breakpoint
CREATE INDEX "order_log_outcome_idx" ON "order_log" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "order_log_dedupe_idx" ON "order_log" USING btree ("account_id","instrument","created_at");