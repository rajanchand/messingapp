CREATE TABLE "pending_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text,
	"requested_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "room_invite_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "room_invite_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_requested_by_admin_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_reviewed_by_admin_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invite_tokens" ADD CONSTRAINT "room_invite_tokens_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_approvals_status_idx" ON "pending_approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_approvals_kind_idx" ON "pending_approvals" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "pending_approvals_created_idx" ON "pending_approvals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "room_invite_tokens_room_idx" ON "room_invite_tokens" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_invite_tokens_created_idx" ON "room_invite_tokens" USING btree ("created_at");
