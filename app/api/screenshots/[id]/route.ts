import { NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { uploadedScreenshots } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await auth();
    if (!userId) return new NextResponse('Unauthorized', { status: 401 });
    const user = await getOrCreateUser();
    if (!user) return new NextResponse('Unauthorized', { status: 401 });

    const { id } = await params;
    const db = getDb();
    const [screenshot] = await db.select().from(uploadedScreenshots).where(and(
      eq(uploadedScreenshots.id, id),
      eq(uploadedScreenshots.userId, user.id),
    )).limit(1);
    if (!screenshot) return new NextResponse('Screenshot not found', { status: 404 });

    const blob = await get(screenshot.pathname, { access: 'private' });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return new NextResponse('Screenshot unavailable', { status: 502 });

    return new Response(blob.stream, {
      status: 200,
      headers: {
        'Content-Type': blob.blob.contentType || screenshot.contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Screenshot read error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to read screenshot' }, { status: 500 });
  }
}
