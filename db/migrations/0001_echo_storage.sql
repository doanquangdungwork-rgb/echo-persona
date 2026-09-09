CREATE TABLE IF NOT EXISTS "uploaded_screenshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "persona_id" uuid REFERENCES "personas"("id") ON DELETE SET NULL,
  "pathname" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uploaded_screenshots_user_id_idx" ON "uploaded_screenshots" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "uploaded_screenshots_persona_id_idx" ON "uploaded_screenshots" ("persona_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "reply" text NOT NULL,
  "scheduled_at" timestamptz NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "delivered_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_messages_due_idx" ON "scheduled_messages" ("status", "scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scheduled_messages_conversation_idx" ON "scheduled_messages" ("conversation_id");
