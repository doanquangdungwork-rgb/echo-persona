import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { personaMemories, personas, uploadedScreenshots } from '@/db/schema';
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
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: 'GEMINI_API_KEY is missing from the deployment.' }, { status: 500 });

    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    const body = await req.json();
    const requestedIds: string[] = Array.isArray(body.screenshotIds)
      ? body.screenshotIds.map((id: unknown) => String(id)).filter(Boolean).slice(0, MAX_FILES)
      : body.screenshotId ? [String(body.screenshotId)] : [];
    const persona = body.persona ?? {};
    const personaId = persona?.id ? String(persona.id) : '';

    const db = getDb();
    let existingPersona: typeof personas.$inferSelect | null = null;
    if (personaId) {
      const [owned] = await db.select().from(personas).where(and(eq(personas.id, personaId), eq(personas.userId, user.id))).limit(1);
      if (!owned) return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
      existingPersona = owned;
    }

    const allScreenshots = await db.select().from(uploadedScreenshots).where(eq(uploadedScreenshots.userId, user.id));
    // A project is the complete evidence set. Re-analysis therefore uses every screenshot
    // currently attached to the project, so adding/removing evidence actually changes the model.
    let selected = personaId
      ? allScreenshots.filter(s => s.personaId === personaId)
      : requestedIds.map(id => allScreenshots.find(s => s.id === id)).filter(Boolean) as typeof allScreenshots;
    if (!selected.length && requestedIds.length) {
      selected = requestedIds.map(id => allScreenshots.find(s => s.id === id)).filter(Boolean) as typeof allScreenshots;
    }
    if (!selected.length) return NextResponse.json({ error: 'At least one screenshot is required for this project.' }, { status: 400 });
    selected = selected.slice(0, MAX_FILES);

    const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [{
      type: 'text',
      text: `You are analyzing a chat archive to build a HIGH-FIDELITY communication model for one target person. Treat all ${selected.length} screenshots as ONE chronological evidence set, not separate examples.

TARGET CONTEXT:
Name: ${persona.name || existingPersona?.name || 'Not provided'}
Relationship: ${persona.relationship || existingPersona?.relationship || 'Not provided'}
Personality supplied by user: ${persona.traits || existingPersona?.personality || 'Not provided'}
Texting style supplied by user: ${persona.style || existingPersona?.textingStyle || 'Not provided'}

CRITICAL ANALYSIS RULES:
- Identify the target speaker by the consistent speaker position/alignment and conversational role across screenshots. Analyze ONLY that person's messages as behavioral evidence.
- Do not average both speakers together.
- Reconstruct observable behavior, not hidden identity or sensitive attributes.
- Separate stable patterns from one-off wording.
- Look for what the target person DOES and also what they consistently DO NOT do.
- Pay special attention to how they open a reply, acknowledge something, react to affection, tease, disagree, comfort, ask questions, change topics, end a conversation, and send follow-up messages.
- Measure message length, number of bubbles per turn, sentence fragments, lowercase/capitalization, punctuation, spacing, typos, abbreviations, slang, emoji frequency/type, repeated particles and signature phrases.
- Infer conversational rhythm from the actual sequence: whether they answer immediately, answer one point first, leave a point unanswered, add an afterthought, or split one thought across several bubbles.
- Do not make the persona more articulate, complete, polite, enthusiastic, emotional, or grammatically correct than the evidence.
- Manual persona inputs are authoritative for identity/context. Do not overwrite them with guesses.

Return strict JSON with exactly these keys:
observations: concise array of concrete observations
stable_patterns: array of high-confidence patterns that should be followed repeatedly
negative_patterns: array of things the target generally avoids doing
signature_patterns: array of recurring words, particles, punctuation or stylistic habits
response_dynamics: object with keys opening, acknowledgement, questions, affection, teasing, conflict, comfort, topic_shift, endings, bubble_structure
message_profile: object with keys typical_length, short_reply_length, long_reply_length, line_breaks, casing, punctuation, emoji, slang, typo_style, repetition
conversation_facts: array of durable facts explicitly stated in the screenshots (job, study, city, preferences, plans, family, etc.)
dna: object containing language, casing, punctuation, message_length, slang, emoji, repeated_phrases, cadence, directness, humor, affection, questions, conflict_style, comfort_style, opening_style, acknowledgement_style, follow_up_style, bubble_structure, negative_patterns, signature_patterns

Never infer protected/sensitive traits. Never guess gender from appearance or name.`,
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
      maxOutputTokens: 2600,
    });

    let analysis: any;
    try {
      const cleaned = result.text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.error('Invalid AI analysis JSON:', result.text);
      return NextResponse.json({ error: 'AI returned invalid analysis JSON. Please try again.' }, { status: 502 });
    }

    const min = Math.max(10, Number(persona?.cadenceMin) || existingPersona?.replyMin || 30);
    const max = Math.max(min, Number(persona?.cadenceMax) || existingPersona?.replyMax || 600);
    const mergedDna = {
      ...(existingPersona?.dna && typeof existingPersona.dna === 'object' ? existingPersona.dna : {}),
      ...(analysis.dna || {}),
      observations: analysis.observations || [],
      stable_patterns: analysis.stable_patterns || [],
      negative_patterns: analysis.negative_patterns || [],
      signature_patterns: analysis.signature_patterns || [],
      response_dynamics: analysis.response_dynamics || {},
      message_profile: analysis.message_profile || {},
    };

    const base = {
      name: String(persona?.name || existingPersona?.name || 'Alex').trim() || 'Alex',
      gender: String(persona?.gender || existingPersona?.gender || 'Other'),
      relationship: String(persona?.relationship || existingPersona?.relationship || 'Other'),
      personality: String(persona?.traits || existingPersona?.personality || ''),
      textingStyle: String(persona?.style || existingPersona?.textingStyle || ''),
      replyMin: min,
      replyMax: max,
      replyMode: existingPersona?.replyMode || 'range',
      dna: mergedDna,
      updatedAt: new Date(),
    };

    let resolvedPersonaId = personaId;
    if (resolvedPersonaId) {
      await db.update(personas).set(base).where(and(eq(personas.id, resolvedPersonaId), eq(personas.userId, user.id)));
    } else {
      const [created] = await db.insert(personas).values({ ...base, userId: user.id }).returning();
      resolvedPersonaId = created.id;
    }

    await Promise.all(selected.map(s => db.update(uploadedScreenshots).set({ personaId: resolvedPersonaId }).where(and(eq(uploadedScreenshots.id, s.id), eq(uploadedScreenshots.userId, user.id)))));

    // Persist durable facts learned from the imported archive, not just from live chat.
    const existingMemoryRows = await db.select().from(personaMemories).where(eq(personaMemories.personaId, resolvedPersonaId));
    const existingMemories = new Set(existingMemoryRows.map(m => m.memory.toLowerCase()));
    const facts = Array.isArray(analysis.conversation_facts) ? analysis.conversation_facts : [];
    for (const raw of facts.slice(0, 15)) {
      const memory = String(raw || '').replace(/^[-*•]\s*/, '').trim();
      if (memory.length >= 4 && !existingMemories.has(memory.toLowerCase())) {
        await db.insert(personaMemories).values({ personaId: resolvedPersonaId, memory, importance: 3 });
        existingMemories.add(memory.toLowerCase());
      }
    }

    return NextResponse.json({
      persona: {
        id: resolvedPersonaId,
        name: base.name,
        gender: base.gender,
        relationship: base.relationship,
        traits: base.personality,
        style: base.textingStyle,
        cadenceMin: base.replyMin,
        cadenceMax: base.replyMax,
        cadenceMode: base.replyMode,
        analysis: mergedDna,
      },
      screenshotIds: selected.map(s => s.id),
    });
  } catch (error) {
    console.error('Persona analysis error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to analyze screenshots: ${message}` }, { status: 500 });
  }
}
