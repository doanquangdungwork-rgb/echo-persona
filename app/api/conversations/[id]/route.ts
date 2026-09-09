import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { asc, and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { conversations, messages, personas } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { const { userId } = await auth(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const user = await getOrCreateUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const { id } = await params; const db = getDb(); const [conversation] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, user.id))).limit(1); if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 }); const [persona] = await db.select().from(personas).where(eq(personas.id, conversation.personaId)).limit(1); const rows = await db.select().from(messages).where(eq(messages.conversationId, conversation.id)).orderBy(asc(messages.createdAt)); return NextResponse.json({ conversation, persona, messages: rows }); }
