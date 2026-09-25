ALTER TABLE "runs" ADD COLUMN "agent" text DEFAULT 'banglaclaw' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "agent_path" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "handoff_reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_agent" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "handoff_reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "handoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "sessions" USING btree ("status","updated_at");