import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personas, uploadedScreenshots } from '@/db/schema';
import { get } from '@vercel/blob';
import { getOrCreateUser } from '@/lib/current-user';

export const runtime = 'nodejs';
const MAX_FILES = 20;

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    const body = await req.json();
    const screenshotIds: string[] = Array.isArray(body.screenshotIds)
      ? body.screenshotIds.map((id: unknown) => String(id)).filter(Boolean).slice(0, MAX_FILES)
      : body.screenshotId ? [String(body.screenshotId)] : [];
    const persona = body.persona ?? {};
    if (!screenshotIds.length) return NextResponse.json({ error: 'At least one screenshotId is required.' }, { status: 400 });
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: 'GEMINI_API_KEY is missing from the deployment.' }, { status: 500 });

    const db = getDb();
    const allScreenshots = await db.select().from(uploadedScreenshots).where(eq(uploadedScreenshots.userId, user.id));
    const selected = screenshotIds.map(id => allScreenshots.find(s => s.id === id)).filter(Boolean) as typeof allScreenshots;
    if (selected.length !== screenshotIds.length) return NextResponse.json({ error: 'One or more screenshots were not found.' }, { status: 404 });

    const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [{
      type: 'text',
      text: `Analyze ${selected.length} screenshots as ONE evidence set from the same conversation archive. Reconstruct only observable texting behavior of the target person. Manual persona inputs are authoritative for identity/context and must not be overwritten by guesses. Name: ${persona.name || 'Not provided'}. Relationship: ${persona.relationship || 'Not provided'}. Personality: ${persona.traits || 'Not provided'}. Texting style: ${persona.style || 'Not provided'}. Return strict JSON with keys observations and dna. observations is a concise array of concrete behavioral observations. dna is an object of useful future-reply constraints: language, casing, punctuation, message_length, slang, emoji, repeated_phrases, cadence, directness, humor, affection, questions, conflict_style, comfort_style. Never infer sensitive/protected attributes. Never guess gender from appearance or name.`
    }];

    for (const screenshot of selected) {
      const blobResult = await get(screenshot.pathname, { access: 'private' });
      if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
        return NextResponse.json({ error: `Could not read screenshot ${screenshot.id} from Vercel Blob.` }, { status: 502 });
      }
      const bytes = Buffer.from(await new Response(blobResult.stream).arrayBuffer());
      content.push({ type: 'image', image: `data:${blobResult.blob.contentType || screenshot.contentType};base64,${bytes.toString('base64')}` });
    }

    const result = await generateText({
      model: google(process.env.GEMINI_MODEL || 'gemini-3.6-flash'),
      messages: [{ role: 'user', content }],
      maxOutputTokens: 1800,
    });

    let analysis: any;
    try {
      const cleaned = result.text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error('Invalid AI analysis JSON:', result.text);
      return NextResponse.json({ error: 'AI returned invalid analysis JSON. Please try again.' }, { status: 502 });
    }

    let personaId = persona?.id as string | undefined;
    const min = Math.max(10, Number(persona?.cadenceMin) || 30);
    const max = Math.max(min, Number(persona?.cadenceMax) || 600);
    let existingDna: any = null;
    if (personaId) {
      const [owned] = await db.select().from(personas).where(and(eq(personas.id, personaId), eq(personas.userId, user.id))).limit(1);
      if (!owned) return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
      existingDna = owned.dna;
    }
    const mergedDna = { ...(existingDna && typeof existingDna === 'object' ? existingDna : {}), ...(analysis.dna || {}), observations: analysis.observations || [] };

    const base = {
      name: String(persona?.name || 'Alex').trim() || 'Alex',
      gender: String(persona?.gender || 'Other'),
      relationship: String(persona?.relationship || 'Other'),
      personality: String(persona?.traits || ''),
      textingStyle: String(persona?.style || ''),
      replyMin: min,
      replyMax: max,
      dna: mergedDna,
      updatedAt: new Date(),
    };

    if (personaId) {
      await db.update(personas).set(base).where(and(eq(personas.id, personaId), eq(personas.userId, user.id)));
    } else {
      const [created] = await db.insert(personas).values({ ...base, userId: user.id }).returning();
      personaId = created.id;
    }

    await Promise.all(selected.map(s => db.update(uploadedScreenshots).set({ personaId }).where(and(eq(uploadedScreenshots.id, s.id), eq(uploadedScreenshots.userId, user.id)))));

    return NextResponse.json({
      persona: { id: personaId, name: base.name, gender: base.gender, relationship: base.relationship, traits: base.personality, style: base.textingStyle, analysis: mergedDna },
      screenshotIds,
    });
  } catch (error) {
    console.error('Persona analysis error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to analyze screenshots: ${message}` }, { status: 500 });
  }
}
