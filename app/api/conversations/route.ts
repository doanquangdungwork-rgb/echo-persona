import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { conversations, messages } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';
export async function GET() { const { userId } = await auth(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const user = await getOrCreateUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const db = getDb(); const rows = await db.select().from(conversations).where(eq(conversations.userId, user.id)).orderBy(desc(conversations.updatedAt)); const result = []; for (const row of rows.slice(0, 20)) { const msgs = await db.select().from(messages).where(eq(messages.conversationId, row.id)).orderBy(desc(messages.createdAt)); result.push({ ...row, lastMessage: msgs[0] ?? null }); } return NextResponse.json({ conversations: result }); }
