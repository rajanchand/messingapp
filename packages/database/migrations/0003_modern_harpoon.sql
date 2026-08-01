CREATE TABLE "ip_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cidr" text NOT NULL,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "ip_allowlist_cidr_unique" UNIQUE("cidr")
);
--> statement-breakpoint
ALTER TABLE "ip_allowlist" ADD CONSTRAINT "ip_allowlist_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ip_allowlist_created_idx" ON "ip_allowlist" USING btree ("created_at");
