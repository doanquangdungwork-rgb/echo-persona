import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personas, uploadedScreenshots } from '@/db/schema';
import { get } from '@vercel/blob';
import { getOrCreateUser } from '@/lib/current-user';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getOrCreateUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('BLOB_READ_WRITE_TOKEN is missing');
      return NextResponse.json(
        {
          error:
            'Vercel Blob is not connected to this project. Connect the EchoBlob store to the Echo Persona Vercel project.',
        },
        { status: 500 }
      );
    }

    const { screenshotId, persona } = await req.json();

    if (!screenshotId) {
      return NextResponse.json(
        { error: 'screenshotId is required' },
        { status: 400 }
      );
    }

    const db = getDb();

    const [screenshot] = await db
      .select()
      .from(uploadedScreenshots)
      .where(
        and(
          eq(uploadedScreenshots.id, screenshotId),
          eq(uploadedScreenshots.userId, user.id)
        )
      )
      .limit(1);

    if (!screenshot) {
      return NextResponse.json(
        { error: 'Screenshot not found' },
        { status: 404 }
      );
    }

    const blobResult = await get(screenshot.pathname, {
      access: 'private',
    });

    if (!blobResult || blobResult.statusCode !== 200) {
      console.error('Could not read private Blob:', {
        pathname: screenshot.pathname,
        statusCode: blobResult?.statusCode,
      });

      return NextResponse.json(
        { error: 'Could not read screenshot from Vercel Blob' },
        { status: 502 }
      );
    }

    const { stream, blob } = blobResult;

    const bytes = Buffer.from(
      await new Response(stream).arrayBuffer()
    );

    const image = `data:${
      blob.contentType || screenshot.contentType
    };base64,${bytes.toString('base64')}`;

    const prompt = `Analyze this chat screenshot to reconstruct the observable texting behavior of the target person only. Return strict JSON with keys: name_guess, relationship_guess, traits, style, dna. Do not infer protected or sensitive personal attributes. Do not guess gender from appearance or name; leave it empty. Focus on message length, casing, punctuation, slang, emojis, repeated phrases, line breaks, directness, humor, affection, response habits, question frequency, and conflict/comfort style. dna must be a concise object of concrete observations useful for future reply generation.`;

    const result = await generateText({
      model: openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image', image },
          ],
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 1000,
    });

    let x: any;

    try {
      x = JSON.parse(result.text);
    } catch {
      return NextResponse.json(
        { error: 'AI returned invalid analysis JSON' },
        { status: 502 }
      );
    }

    let personaId = persona?.id as string | undefined;

    const base = {
      name: String(x.name_guess || persona?.name || 'Alex'),
      gender: String(persona?.gender || 'Other'),
      relationship: String(
        x.relationship_guess || persona?.relationship || 'Other'
      ),
      personality: String(x.traits || persona?.traits || ''),
      textingStyle: String(x.style || persona?.style || ''),
      replyMin: Math.max(10, Number(persona?.cadenceMin) || 30),
      replyMax: Math.max(
        Math.max(10, Number(persona?.cadenceMax) || 600),
        Math.max(10, Number(persona?.cadenceMin) || 30)
      ),
      dna: x.dna || null,
      updatedAt: new Date(),
    };

    if (personaId) {
      const [owned] = await db
        .select()
        .from(personas)
        .where(
          and(
            eq(personas.id, personaId),
            eq(personas.userId, user.id)
          )
        )
        .limit(1);

      if (!owned) {
        return NextResponse.json(
          { error: 'Persona not found' },
          { status: 404 }
        );
      }

      const [updated] = await db
        .update(personas)
        .set(base)
        .where(
          and(
            eq(personas.id, personaId),
            eq(personas.userId, user.id)
          )
        )
        .returning();

      personaId = updated.id;
    } else {
      const [created] = await db
        .insert(personas)
        .values({ ...base, userId: user.id })
        .returning();

      personaId = created.id;
    }

    await db
      .update(uploadedScreenshots)
      .set({ personaId })
      .where(
        and(
          eq(uploadedScreenshots.id, screenshot.id),
          eq(uploadedScreenshots.userId, user.id)
        )
      );

    return NextResponse.json({
      persona: {
        id: personaId,
        name: base.name,
        gender: base.gender,
        relationship: base.relationship,
        traits: base.personality,
        style: base.textingStyle,
        analysis: base.dna,
      },
      screenshotId: screenshot.id,
    });
  } catch (error) {
    console.error('Persona analysis error:', error);

    return NextResponse.json(
      { error: 'Failed to analyze screenshot' },
      { status: 500 }
    );
  }
}
