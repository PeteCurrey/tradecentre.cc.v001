CREATE TYPE "public"."goal_metric" AS ENUM('total_r', 'expectancy_r', 'win_rate', 'max_drawdown_r', 'profit_factor', 'trade_count', 'adherence_pct');--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"metric" "goal_metric" NOT NULL,
	"target" numeric(12, 4) NOT NULL,
	"lower_is_better" boolean DEFAULT false NOT NULL,
	"book" "book",
	"note" text,
	"achieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "goal_period_idx" ON "goals" USING btree ("period");