import { pgTable, text, integer, timestamp, jsonb, uuid, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const personas = pgTable('personas', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  gender: text('gender').notNull(),
  relationship: text('relationship').notNull(),
  personality: text('personality').notNull(),
  textingStyle: text('texting_style').notNull(),
  replyMin: integer('reply_min').notNull().default(30),
  replyMax: integer('reply_max').notNull().default(600),
  dna: jsonb('dna'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('personas_user_id_idx').on(t.userId)]);

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personaId: uuid('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('conversations_user_id_idx').on(t.userId), index('conversations_persona_id_idx').on(t.personaId)]);

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  delayMs: integer('delay_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('messages_conversation_id_idx').on(t.conversationId)]);

export const personaMemories = pgTable('persona_memories', {
  id: uuid('id').defaultRandom().primaryKey(),
  personaId: uuid('persona_id').notNull().references(() => personas.id, { onDelete: 'cascade' }),
  memory: text('memory').notNull(),
  importance: integer('importance').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('persona_memories_persona_id_idx').on(t.personaId)]);

export const uploadedScreenshots = pgTable('uploaded_screenshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personaId: uuid('persona_id').references(() => personas.id, { onDelete: 'set null' }),
  pathname: text('pathname').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('uploaded_screenshots_user_id_idx').on(t.userId), index('uploaded_screenshots_persona_id_idx').on(t.personaId)]);

export const scheduledMessages = pgTable('scheduled_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  reply: text('reply').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, (t) => [index('scheduled_messages_due_idx').on(t.status, t.scheduledAt), index('scheduled_messages_conversation_idx').on(t.conversationId)]);
