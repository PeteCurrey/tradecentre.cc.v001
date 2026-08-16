CREATE TYPE "public"."user_role" AS ENUM('member', 'moderator', 'staff', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"target_user_id" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_target_idx" ON "moderation_actions" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_created_idx" ON "moderation_actions" USING btree ("created_at");