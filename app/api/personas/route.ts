import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personas } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';
export async function GET() { const { userId } = await auth(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const user = await getOrCreateUser(); if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const db = getDb(); const rows = await db.select().from(personas).where(eq(personas.userId, user.id)).orderBy(desc(personas.updatedAt)); return NextResponse.json({ personas: rows }); }
