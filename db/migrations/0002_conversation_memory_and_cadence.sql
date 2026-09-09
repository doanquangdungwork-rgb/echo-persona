ALTER TABLE personas ADD COLUMN IF NOT EXISTS reply_mode text NOT NULL DEFAULT 'range';

CREATE INDEX IF NOT EXISTS persona_memories_persona_id_idx ON persona_memories (persona_id);
