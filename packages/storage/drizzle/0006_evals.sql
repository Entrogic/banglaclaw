CREATE TABLE "eval_cases" (
	"eval_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"name" text,
	"input" text NOT NULL,
	"actual_output" text,
	"expected_output" text,
	"language" text,
	"session_id" text,
	"run_id" text,
	"tools_called" text[],
	"expected_tools" text[],
	"success" boolean NOT NULL,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "eval_cases_eval_id_seq_pk" PRIMARY KEY("eval_id","seq")
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"dataset" text,
	"framework" text NOT NULL,
	"framework_version" text,
	"judge_model" text,
	"agent_model" text,
	"metadata" jsonb,
	"created_by" text,
	"case_count" integer NOT NULL,
	"passed_count" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_eval_id_eval_runs_id_fk" FOREIGN KEY ("eval_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_created_at_idx" ON "eval_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_name_idx" ON "eval_runs" USING btree ("name","created_at");