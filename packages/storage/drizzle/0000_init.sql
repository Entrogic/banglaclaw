CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"run_id" uuid,
	"role" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"prompt_version" text NOT NULL,
	"language" text NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"input" text NOT NULL,
	"output" text,
	"status" text NOT NULL,
	"stop_reason" text,
	"error" text,
	"iterations" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"external_id" text,
	"user_id" text,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool" text NOT NULL,
	"input" jsonb,
	"status" text NOT NULL,
	"output" jsonb,
	"error" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_session_id_idx" ON "messages" USING btree ("session_id","id");--> statement-breakpoint
CREATE INDEX "runs_session_started_idx" ON "runs" USING btree ("session_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_channel_external_id_key" ON "sessions" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX "sessions_updated_at_idx" ON "sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tool_calls_tool_idx" ON "tool_calls" USING btree ("tool");