CREATE TABLE "username_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"username" text NOT NULL,
	"held_from" timestamp with time zone,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "username_history" ADD CONSTRAINT "username_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "username_history_user_idx" ON "username_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "username_history_name_idx" ON "username_history" USING btree (lower("username"));