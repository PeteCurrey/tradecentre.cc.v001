CREATE TYPE "public"."horizon" AS ENUM('scalp', 'intraday', 'swing', 'position');--> statement-breakpoint
CREATE TABLE "app_config" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"horizon_thresholds" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "book" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "book" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "book" SET DATA TYPE text;--> statement-breakpoint

-- ============================================================================
-- HAND-EDITED: remap existing data before the enum is recreated.
--
-- `book` changes meaning from HOLD TIME to INSTRUMENT CLASS, matching the way
-- Peter actually named his OANDA sub-accounts. Drizzle's generated migration
-- cast straight to the new enum, which would abort because 'scalp' is not a
-- member of it.
--
-- The old values map cleanly because the original seed assigned books in
-- sub-account order, and the aliases follow that same order:
--   -001 "Primary"      was scalp     -> primary
--   -002 "FX"           was intraday  -> fx
--   -003 "Indicies"     was swing     -> indices
--   -004 "Commodoties"  was position  -> commodities
--
-- Trades are derived and get rebuilt after this anyway, but remapping keeps the
-- table valid at every point rather than leaving it briefly inconsistent.
-- ============================================================================
UPDATE "accounts" SET "book" = CASE "book"
  WHEN 'scalp' THEN 'primary'
  WHEN 'intraday' THEN 'fx'
  WHEN 'swing' THEN 'indices'
  WHEN 'position' THEN 'commodities'
  ELSE "book" END;--> statement-breakpoint
UPDATE "books" SET "id" = CASE "id"
  WHEN 'scalp' THEN 'primary'
  WHEN 'intraday' THEN 'fx'
  WHEN 'swing' THEN 'indices'
  WHEN 'position' THEN 'commodities'
  ELSE "id" END;--> statement-breakpoint
UPDATE "trades" SET "book" = CASE "book"
  WHEN 'scalp' THEN 'primary'
  WHEN 'intraday' THEN 'fx'
  WHEN 'swing' THEN 'indices'
  WHEN 'position' THEN 'commodities'
  ELSE "book" END;--> statement-breakpoint
UPDATE "opportunities" SET "book" = CASE "book"
  WHEN 'scalp' THEN 'primary'
  WHEN 'intraday' THEN 'fx'
  WHEN 'swing' THEN 'indices'
  WHEN 'position' THEN 'commodities'
  ELSE "book" END;--> statement-breakpoint

DROP TYPE "public"."book";--> statement-breakpoint
CREATE TYPE "public"."book" AS ENUM('primary', 'fx', 'indices', 'commodities');--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "book" SET DATA TYPE "public"."book" USING "book"::"public"."book";--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "id" SET DATA TYPE "public"."book" USING "id"::"public"."book";--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "book" SET DATA TYPE "public"."book" USING "book"::"public"."book";--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "book" SET DATA TYPE "public"."book" USING "book"::"public"."book";--> statement-breakpoint
ALTER TABLE "trade_annotations" ADD COLUMN "horizon_override" "horizon";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "horizon" "horizon";
