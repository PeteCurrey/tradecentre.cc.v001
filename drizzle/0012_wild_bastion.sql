/*
  TENANT SCOPING — the trading tables learn who they belong to.

  Hand-written, replacing what drizzle-kit generated. The generated version
  could not run: it added NOT NULL columns to populated tables with no default,
  added the new composite primary key BEFORE the column it keys on existed, and
  left the old primary key in place (drizzle-kit cannot yet infer its name).

  The ordering below is the whole point — add nullable, backfill, then enforce.
  Every existing row predates multi-tenancy and therefore belongs to the owner,
  who is identified by the reserved external id rather than by a hardcoded id,
  so this migration is correct on any database it is run against.
*/

CREATE TYPE "public"."pattern_visibility" AS ENUM('private', 'house', 'listed');--> statement-breakpoint

/*
  The owner must exist before anything can reference them. Normally created by
  the app on first boot, but a migration cannot assume the app has ever run —
  and a migration that only works on a warm database is not a migration.
*/
INSERT INTO "users" ("external_id", "display_name")
SELECT 'local:owner', 'Peter'
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE "external_id" = 'local:owner');--> statement-breakpoint

/* ---- accounts: the root of tenancy ------------------------------------- */

ALTER TABLE "accounts" ADD COLUMN "user_id" integer;--> statement-breakpoint

UPDATE "accounts"
SET "user_id" = (SELECT "id" FROM "users" WHERE "external_id" = 'local:owner')
WHERE "user_id" IS NULL;--> statement-breakpoint

ALTER TABLE "accounts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

/* ---- execution_state: re-keyed, because `book` alone was global -------- */

ALTER TABLE "execution_state" ADD COLUMN "user_id" integer;--> statement-breakpoint

UPDATE "execution_state"
SET "user_id" = (SELECT "id" FROM "users" WHERE "external_id" = 'local:owner')
WHERE "user_id" IS NULL;--> statement-breakpoint

ALTER TABLE "execution_state" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

/*
  The old key was `book` alone — one row saying "commodities is armed" for
  everybody. Dropping it is what makes a per-member arm state expressible.
*/
ALTER TABLE "execution_state" DROP CONSTRAINT "execution_state_pkey";--> statement-breakpoint

ALTER TABLE "execution_state" ADD CONSTRAINT "execution_state_user_id_book_pk" PRIMARY KEY("user_id","book");--> statement-breakpoint

/* ---- patterns: author + visibility -------------------------------------- */

ALTER TABLE "patterns" ADD COLUMN "user_id" integer;--> statement-breakpoint

ALTER TABLE "patterns" ADD COLUMN "visibility" "pattern_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint

/*
  Everything already in the library is the curated house set — it was seeded,
  not authored by a member. Left with user_id NULL deliberately: the house
  library belongs to the platform, so it survives any individual account being
  detached.
*/
UPDATE "patterns" SET "visibility" = 'house' WHERE "user_id" IS NULL;--> statement-breakpoint

/* ---- foreign keys ------------------------------------------------------- */

/*
  `restrict` on accounts, `cascade` on the other two. Deleting a member must
  not silently destroy an execution ledger — their accounts have to be detached
  deliberately first — whereas arm state and private patterns are theirs alone
  and going with them is correct.
*/
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "execution_state" ADD CONSTRAINT "execution_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "patterns" ADD CONSTRAINT "patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
