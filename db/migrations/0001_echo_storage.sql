CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "clerk_user_id" text NOT NULL UNIQUE,
  "email" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "personas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "gender" text NOT NULL,
  "relationship" text NOT NULL,
  "personality" text NOT NULL,
  "texting_style" text NOT NULL,
  "reply_min" integer DEFAULT 30 NOT NULL,
  "reply_max" integer DEFAULT 600 NOT NULL,
  "dna" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "personas_user_id_idx" ON "personas" ("user_id");

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "persona_id" uuid NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "title" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "conversations_user_id_idx" ON "conversations" ("user_id");
CREATE INDEX IF NOT EXISTS "conversations_persona_id_idx" ON "conversations" ("persona_id");

CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "delay_ms" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "messages_conversation_id_idx" ON "messages" ("conversation_id");

CREATE TABLE IF NOT EXISTS "persona_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "persona_id" uuid NOT NULL REFERENCES "personas"("id") ON DELETE CASCADE,
  "memory" text NOT NULL,
  "importance" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "persona_memories_persona_id_idx" ON "persona_memories" ("persona_id");

CREATE TABLE IF NOT EXISTS "uploaded_screenshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "persona_id" uuid REFERENCES "personas"("id") ON DELETE SET NULL,
  "pathname" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "uploaded_screenshots_user_id_idx" ON "uploaded_screenshots" ("user_id");
CREATE INDEX IF NOT EXISTS "uploaded_screenshots_persona_id_idx" ON "uploaded_screenshots" ("persona_id");

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
CREATE INDEX IF NOT EXISTS "scheduled_messages_due_idx" ON "scheduled_messages" ("status", "scheduled_at");
CREATE INDEX IF NOT EXISTS "scheduled_messages_conversation_idx" ON "scheduled_messages" ("conversation_id");
