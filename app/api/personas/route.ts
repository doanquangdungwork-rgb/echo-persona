import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personas } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const db = getDb();
    const rows = await db.select().from(personas).where(eq(personas.userId, user.id)).orderBy(personas.updatedAt);
    return NextResponse.json({ personas: rows.reverse() });
  } catch (error) {
    console.error('Load personas error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load personas' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const p = body.persona ?? body;
    const db = getDb();
    const min = clamp(Number(p.cadenceMin) || 30, 10, 3600);
    const max = Math.max(min, clamp(Number(p.cadenceMax) || 600, 10, 3600));
    const values = {
      name: String(p.name || 'Alex').trim() || 'Alex',
      gender: String(p.gender || 'Other'),
      relationship: String(p.relationship || 'Other'),
      personality: String(p.traits || p.personality || ''),
      textingStyle: String(p.style || p.textingStyle || ''),
      replyMin: min,
      replyMax: max,
      updatedAt: new Date(),
    };

    if (p.id) {
      const [owned] = await db.select().from(personas).where(eq(personas.id, String(p.id))).limit(1);
      if (!owned || owned.userId !== user.id) return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
      const [updated] = await db.update(personas).set(values).where(eq(personas.id, owned.id)).returning();
      return NextResponse.json({ persona: updated });
    }

    const [created] = await db.insert(personas).values({ ...values, userId: user.id, dna: p.analysis ? { analysis: p.analysis } : null }).returning();
    return NextResponse.json({ persona: created });
  } catch (error) {
    console.error('Save persona error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save persona' }, { status: 500 });
  }
}
