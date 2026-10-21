CREATE TABLE "model_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"temperature" double precision,
	"api_key_ciphertext" text,
	"api_key_hint" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_providers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_providers_one_active_idx" ON "model_providers" USING btree ("active") WHERE "model_providers"."active";