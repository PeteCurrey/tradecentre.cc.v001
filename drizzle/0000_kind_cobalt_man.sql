CREATE TYPE "public"."book" AS ENUM('scalp', 'intraday', 'swing', 'position');--> statement-breakpoint
CREATE TYPE "public"."conviction" AS ENUM('A+', 'A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('live', 'practice');--> statement-breakpoint
CREATE TYPE "public"."process_grade" AS ENUM('A', 'B', 'C', 'D', 'F');--> statement-breakpoint
CREATE TYPE "public"."opportunity_source" AS ENUM('spotted', 'ai', 'engine');--> statement-breakpoint
CREATE TYPE "public"."pattern_status" AS ENUM('incubating', 'live', 'retired');--> statement-breakpoint
CREATE TYPE "public"."trade_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"book" "book" NOT NULL,
	"environment" "environment" NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"alias" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"channels" jsonb DEFAULT '["visual"]'::jsonb NOT NULL,
	"rule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" "book" PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"base_risk_pct" numeric(6, 4) DEFAULT '0.75' NOT NULL,
	"daily_limit_r" numeric(6, 2) DEFAULT '3.00' NOT NULL,
	"conviction_multipliers" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"instrument" text NOT NULL,
	"granularity" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"o" numeric(20, 8) NOT NULL,
	"h" numeric(20, 8) NOT NULL,
	"l" numeric(20, 8) NOT NULL,
	"c" numeric(20, 8) NOT NULL,
	"tick_volume" integer DEFAULT 0 NOT NULL,
	"complete" boolean DEFAULT true NOT NULL,
	CONSTRAINT "candles_instrument_granularity_time_pk" PRIMARY KEY("instrument","granularity","time")
);
--> statement-breakpoint
CREATE TABLE "daily_plans" (
	"day" date PRIMARY KEY NOT NULL,
	"bias" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setups_hunted" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"ai_draft" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_reviews" (
	"day" date PRIMARY KEY NOT NULL,
	"process_grade" "process_grade",
	"adherence_pct" real,
	"what_worked" text,
	"what_broke" text,
	"tomorrow" text,
	"notes" text,
	"ai_draft" text,
	"ai_model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"name" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"type" text NOT NULL,
	"pip_location" smallint NOT NULL,
	"display_precision" smallint NOT NULL,
	"margin_rate" numeric(8, 4),
	"asset_class" text DEFAULT 'fx' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"country" text,
	"title" text NOT NULL,
	"importance" smallint,
	"actual" text,
	"forecast" text,
	"previous" text,
	"implied_probability" real,
	"polymarket_slug" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"instrument" text NOT NULL,
	"source" "opportunity_source" NOT NULL,
	"pattern_id" integer,
	"book" "book",
	"conviction" "conviction",
	"score" real,
	"reasoning" text,
	"invalidation" text,
	"taken" boolean DEFAULT false NOT NULL,
	"linked_account_id" text,
	"linked_oanda_trade_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_examples" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_id" integer NOT NULL,
	"account_id" text NOT NULL,
	"oanda_trade_id" text NOT NULL,
	"kind" text DEFAULT 'canonical' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trigger_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invalidation" text,
	"context_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_logic" text,
	"status" "pattern_status" DEFAULT 'incubating' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patterns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "state_logs" (
	"day" date PRIMARY KEY NOT NULL,
	"sleep" smallint,
	"energy" smallint,
	"focus" smallint,
	"emotion_pre" text,
	"emotion_during" text,
	"emotion_post" text,
	"tilt_markers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "trade_annotations" (
	"account_id" text NOT NULL,
	"oanda_trade_id" text NOT NULL,
	"pattern_id" integer,
	"suggested_pattern_id" integer,
	"pattern_confirmed" boolean DEFAULT false NOT NULL,
	"conviction" "conviction",
	"process_grade" "process_grade",
	"mistakes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_annotations_account_id_oanda_trade_id_pk" PRIMARY KEY("account_id","oanda_trade_id")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"oanda_trade_id" text NOT NULL,
	"book" "book" NOT NULL,
	"instrument" text NOT NULL,
	"direction" "direction" NOT NULL,
	"state" "trade_state" NOT NULL,
	"units" numeric(20, 6) NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"exit_time" timestamp with time zone,
	"exit_price" numeric(20, 8),
	"planned_stop" numeric(20, 8),
	"planned_target" numeric(20, 8),
	"initial_risk" numeric(20, 6),
	"realized_pl" numeric(20, 6),
	"financing" numeric(20, 6) DEFAULT '0' NOT NULL,
	"commission" numeric(20, 6) DEFAULT '0' NOT NULL,
	"r_multiple" real,
	"mae_r" real,
	"mfe_r" real,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions_raw" (
	"account_id" text NOT NULL,
	"id" text NOT NULL,
	"type" text NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_raw_account_id_id_pk" PRIMARY KEY("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "watchlist_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument" text NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"label" text,
	"kind" text DEFAULT 'level' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_pattern_id_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."patterns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_examples" ADD CONSTRAINT "pattern_examples_pattern_id_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."patterns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_pattern_id_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."patterns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_suggested_pattern_id_patterns_id_fk" FOREIGN KEY ("suggested_pattern_id") REFERENCES "public"."patterns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions_raw" ADD CONSTRAINT "transactions_raw_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "ai_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_task_idx" ON "ai_runs" USING btree ("task");--> statement-breakpoint
CREATE INDEX "macro_time_idx" ON "macro_events" USING btree ("time");--> statement-breakpoint
CREATE INDEX "opp_day_idx" ON "opportunities" USING btree ("day");--> statement-breakpoint
CREATE INDEX "opp_source_idx" ON "opportunities" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_account_oanda_idx" ON "trades" USING btree ("account_id","oanda_trade_id");--> statement-breakpoint
CREATE INDEX "trade_entry_time_idx" ON "trades" USING btree ("entry_time");--> statement-breakpoint
CREATE INDEX "trade_book_state_idx" ON "trades" USING btree ("book","state");--> statement-breakpoint
CREATE INDEX "trade_instrument_idx" ON "trades" USING btree ("instrument");--> statement-breakpoint
CREATE INDEX "tx_account_time_idx" ON "transactions_raw" USING btree ("account_id","time");--> statement-breakpoint
CREATE INDEX "tx_type_idx" ON "transactions_raw" USING btree ("type");