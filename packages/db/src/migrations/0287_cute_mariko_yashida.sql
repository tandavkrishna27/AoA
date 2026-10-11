-- C14: generated transition objects are guarded so a partial replay is safe.
CREATE TABLE IF NOT EXISTS "budget_capacity_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"operation_kind" text NOT NULL,
	"operation_id" text NOT NULL,
	"agent_id" uuid,
	"project_id" uuid,
	"maximum_cost_cents" integer NOT NULL,
	"settled_cost_cents" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"stop_requested_at" timestamp with time zone,
	"stop_reason" text,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_capacity_reservations_amount_check" CHECK ("budget_capacity_reservations"."maximum_cost_cents" > 0 AND "budget_capacity_reservations"."settled_cost_cents" >= 0),
	CONSTRAINT "budget_capacity_reservations_state_check" CHECK ("budget_capacity_reservations"."state" IN ('held','unknown','settled','released'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_capacity_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"charge_id" text NOT NULL,
	"cost_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_capacity_settlements_cost_check" CHECK ("budget_capacity_settlements"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_attention_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"destination_kind" text NOT NULL,
	"destination_id" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"attachment_asset_ids" jsonb NOT NULL,
	"payload" jsonb,
	"pending_attempt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_intake_parts" (
	"intake_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"part_index" integer NOT NULL,
	"object_key" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_intake_parts_intake_id_part_index_pk" PRIMARY KEY("intake_id","part_index")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_key" text NOT NULL,
	"client_key" uuid NOT NULL,
	"payload_sha256" text NOT NULL,
	"destination" jsonb NOT NULL,
	"filename" text NOT NULL,
	"declared_content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"state" text DEFAULT 'receiving' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"asset_id" uuid,
	"final_object_key" text,
	"final_byte_size" integer,
	"final_sha256" text,
	"reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_layout_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layout_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"acknowledgement" jsonb,
	"acknowledged_revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_panel_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"panel_key" text NOT NULL,
	"source_version_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "universe_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_secrets" ADD COLUMN "resolution_scope" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_agent_messages" ADD COLUMN "submission_payload_hash" text;--> statement-breakpoint
ALTER TABLE "budget_capacity_reservations" ADD CONSTRAINT "budget_capacity_reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_capacity_reservations" ADD CONSTRAINT "budget_capacity_reservations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_capacity_reservations" ADD CONSTRAINT "budget_capacity_reservations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_capacity_settlements" ADD CONSTRAINT "budget_capacity_settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_capacity_settlements" ADD CONSTRAINT "budget_capacity_settlements_reservation_id_budget_capacity_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."budget_capacity_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_attention_checkpoints" ADD CONSTRAINT "universe_attention_checkpoints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_attention_checkpoints" ADD CONSTRAINT "universe_attention_checkpoints_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_drafts" ADD CONSTRAINT "universe_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_intake_parts" ADD CONSTRAINT "universe_intake_parts_intake_id_universe_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."universe_intakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_intake_parts" ADD CONSTRAINT "universe_intake_parts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_intake_parts" ADD CONSTRAINT "universe_intake_parts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_intakes" ADD CONSTRAINT "universe_intakes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_intakes" ADD CONSTRAINT "universe_intakes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_intakes" ADD CONSTRAINT "universe_intakes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_layout_operations" ADD CONSTRAINT "universe_layout_operations_layout_id_universe_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."universe_layouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_layout_operations" ADD CONSTRAINT "universe_layout_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_layouts" ADD CONSTRAINT "universe_layouts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_panel_checkpoints" ADD CONSTRAINT "universe_panel_checkpoints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_preferences" ADD CONSTRAINT "universe_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universe_preferences" ADD CONSTRAINT "universe_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_capacity_reservations_operation_uq" ON "budget_capacity_reservations" USING btree ("company_id","operation_kind","operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_capacity_reservations_company_state_window_idx" ON "budget_capacity_reservations" USING btree ("company_id","state","window_start","window_end");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_capacity_settlements_charge_uq" ON "budget_capacity_settlements" USING btree ("company_id","charge_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_capacity_settlements_reservation_idx" ON "budget_capacity_settlements" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_attention_checkpoints_company_user_uq" ON "universe_attention_checkpoints" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universe_drafts_company_user_idx" ON "universe_drafts" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_drafts_owner_destination_uq" ON "universe_drafts" USING btree ("user_id","company_id","conversation_id","destination_kind","destination_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universe_intake_parts_company_intake_idx" ON "universe_intake_parts" USING btree ("company_id","intake_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_intake_parts_object_key_uq" ON "universe_intake_parts" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_intakes_owner_client_uq" ON "universe_intakes" USING btree ("company_id","actor_key","client_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universe_intakes_company_state_idx" ON "universe_intakes" USING btree ("company_id","state","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universe_intakes_asset_idx" ON "universe_intakes" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_layout_operations_layout_op_uq" ON "universe_layout_operations" USING btree ("layout_id","operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "universe_layouts_company_user_idx" ON "universe_layouts" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_layouts_owner_conversation_uq" ON "universe_layouts" USING btree ("user_id","company_id","conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_checkpoints_owner_version_uq" ON "universe_panel_checkpoints" USING btree ("company_id","user_id","conversation_id","panel_key","source_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "universe_preferences_company_user_uq" ON "universe_preferences" USING btree ("company_id","user_id");--> statement-breakpoint
ALTER TABLE "company_secrets" ADD CONSTRAINT "company_secrets_resolution_scope_check" CHECK ("company_secrets"."resolution_scope" IN ('general','voice_media'));