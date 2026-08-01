CREATE TABLE "matrix_user_profiles" (
	"matrix_user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"email" text,
	"phone" text,
	"employee_id" text,
	"department" text,
	"subdepartment" text,
	"primary_role_slug" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matrix_user_profiles" ADD CONSTRAINT "matrix_user_profiles_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matrix_user_profiles_email_idx" ON "matrix_user_profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "matrix_user_profiles_employee_idx" ON "matrix_user_profiles" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "matrix_user_profiles_department_idx" ON "matrix_user_profiles" USING btree ("department");
