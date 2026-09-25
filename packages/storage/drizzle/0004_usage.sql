ALTER TABLE "runs" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;