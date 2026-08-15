CREATE TABLE "feed_items" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"category" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"headline" text NOT NULL,
	"summary" text,
	"url" text,
	"tickers" text[] DEFAULT '{}' NOT NULL,
	"instruments" text[] DEFAULT '{}' NOT NULL,
	"importance" smallint,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feed_published_idx" ON "feed_items" USING btree ("published_at");