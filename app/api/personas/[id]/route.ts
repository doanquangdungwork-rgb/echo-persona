import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personas, uploadedScreenshots } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const db = getDb();

    const [persona] = await db.select().from(personas).where(and(eq(personas.id, id), eq(personas.userId, user.id))).limit(1);
    if (!persona) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const screenshots = await db.select().from(uploadedScreenshots).where(and(
      eq(uploadedScreenshots.personaId, persona.id),
      eq(uploadedScreenshots.userId, user.id),
    ));
    await Promise.allSettled(screenshots.map(s => del(s.pathname)));
    await db.delete(personas).where(and(eq(personas.id, persona.id), eq(personas.userId, user.id)));

    return NextResponse.json({ deleted: persona.id });
  } catch (error) {
    console.error('Delete project error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete project' }, { status: 500 });
  }
}
