import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personas, uploadedScreenshots } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await context.params;
    const user = await getOrCreateUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const db = getDb();
    const [persona] = await db.select({ id: personas.id }).from(personas)
      .where(and(eq(personas.id, id), eq(personas.userId, user.id))).limit(1);
    if (!persona) return Response.json({ error: 'Project not found' }, { status: 404 });
    const rows = await db.select().from(uploadedScreenshots)
      .where(and(eq(uploadedScreenshots.personaId, persona.id), eq(uploadedScreenshots.userId, user.id)))
      .orderBy(asc(uploadedScreenshots.createdAt));
    return Response.json({ screenshots: rows.map(row => ({ id: row.id, url: `/api/screenshots/${row.id}`, pathname: row.pathname, sizeBytes: row.sizeBytes, createdAt: row.createdAt })) });
  } catch (error) {
    console.error('Load project screenshots error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to load project screenshots' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await context.params;
    const user = await getOrCreateUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const screenshotId = String(body.screenshotId || '').trim();
    if (!screenshotId) return Response.json({ error: 'screenshotId is required.' }, { status: 400 });
    const db = getDb();
    const [persona] = await db.select({ id: personas.id }).from(personas)
      .where(and(eq(personas.id, id), eq(personas.userId, user.id))).limit(1);
    if (!persona) return Response.json({ error: 'Project not found' }, { status: 404 });
    const [screenshot] = await db.select().from(uploadedScreenshots).where(and(
      eq(uploadedScreenshots.id, screenshotId),
      eq(uploadedScreenshots.personaId, persona.id),
      eq(uploadedScreenshots.userId, user.id),
    )).limit(1);
    if (!screenshot) return Response.json({ error: 'Screenshot not found in this project.' }, { status: 404 });
    await del(screenshot.pathname);
    await db.delete(uploadedScreenshots).where(and(eq(uploadedScreenshots.id, screenshot.id), eq(uploadedScreenshots.userId, user.id)));
    await db.update(personas).set({ dna: null, updatedAt: new Date() }).where(and(eq(personas.id, persona.id), eq(personas.userId, user.id)));
    return Response.json({ deleted: screenshot.id, analysisStale: true });
  } catch (error) {
    console.error('Delete project screenshot error:', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to delete screenshot' }, { status: 500 });
  }
}
