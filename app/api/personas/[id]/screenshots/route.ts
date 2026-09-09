import { NextResponse } from 'next/server';
import { del, get } from '@vercel/blob';
import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personas, uploadedScreenshots } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

async function getOwnedPersona(id: string, userId: string) {
  const user = await getOrCreateUser();
  if (!user) return null;
  const db = getDb();
  const [persona] = await db.select().from(personas).where(and(eq(personas.id, id), eq(personas.userId, user.id))).limit(1);
  return persona ?? null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const persona = await getOwnedPersona(id, userId);
    if (!persona) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const db = getDb();
    const rows = await db.select().from(uploadedScreenshots)
      .where(and(eq(uploadedScreenshots.personaId, persona.id), eq(uploadedScreenshots.userId, (await getOrCreateUser())!.id)))
      .orderBy(asc(uploadedScreenshots.createdAt));
    return NextResponse.json({ screenshots: rows.map(row => ({ ...row, url: `/api/screenshots/${row.id}` })) });
  } catch (error) {
    console.error('Load project screenshots error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load project screenshots' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const persona = await getOwnedPersona(id, userId);
    if (!persona) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const screenshotId = String(body.screenshotId || '');
    if (!screenshotId) return NextResponse.json({ error: 'screenshotId is required.' }, { status: 400 });

    const db = getDb();
    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const [screenshot] = await db.select().from(uploadedScreenshots).where(and(
      eq(uploadedScreenshots.id, screenshotId),
      eq(uploadedScreenshots.personaId, persona.id),
      eq(uploadedScreenshots.userId, user.id),
    )).limit(1);
    if (!screenshot) return NextResponse.json({ error: 'Screenshot not found in this project.' }, { status: 404 });

    try { await del(screenshot.pathname); } catch (blobError) { console.warn('Blob deletion skipped:', blobError); }
    await db.delete(uploadedScreenshots).where(eq(uploadedScreenshots.id, screenshot.id));
    return NextResponse.json({ deleted: screenshot.id });
  } catch (error) {
    console.error('Delete project screenshot error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete screenshot' }, { status: 500 });
  }
}
