CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_slug" text NOT NULL,
	"user_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"topic" text,
	"instrument" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_slug_chat_rooms_slug_fk" FOREIGN KEY ("room_slug") REFERENCES "public"."chat_rooms"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_room_idx" ON "chat_messages" USING btree ("room_slug","id");--> statement-breakpoint
CREATE INDEX "chat_rooms_archived_idx" ON "chat_rooms" USING btree ("archived");--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_idx" ON "users" USING btree ("external_id");