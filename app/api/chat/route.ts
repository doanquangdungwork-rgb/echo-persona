import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { conversations, messages, personas, personaMemories, scheduledMessages } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)); }

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!process.env.GEMINI_API_KEY) return NextResponse.json({ error: 'GEMINI_API_KEY is missing from the deployment.' }, { status: 500 });

    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
    const body = await req.json();
    const text = String(body.message ?? '').trim();
    if (!text) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

    const p = body.persona ?? {};
    const db = getDb();
    let activePersona;

    if (p.id) {
      [activePersona] = await db.select().from(personas).where(and(eq(personas.id, String(p.id)), eq(personas.userId, user.id))).limit(1);
      if (!activePersona) return NextResponse.json({ error: 'Persona not found' }, { status: 404 });
      [activePersona] = await db.update(personas).set({
        name: String(p.name || activePersona.name),
        gender: String(p.gender || activePersona.gender),
        relationship: String(p.relationship || activePersona.relationship),
        personality: String(p.traits || activePersona.personality),
        textingStyle: String(p.style || activePersona.textingStyle),
        replyMin: clamp(Number(p.cadenceMin) || activePersona.replyMin, 10, 3600),
        replyMax: Math.max(clamp(Number(p.cadenceMax) || activePersona.replyMax, 10, 3600), clamp(Number(p.cadenceMin) || activePersona.replyMin, 10, 3600)),
        replyMode: p.cadenceMode === 'instant' ? 'instant' : 'range',
        updatedAt: new Date(),
      }).where(and(eq(personas.id, activePersona.id), eq(personas.userId, user.id))).returning();
    } else {
      const min = clamp(Number(p.cadenceMin) || 30, 10, 3600);
      const max = Math.max(clamp(Number(p.cadenceMax) || 600, 10, 3600), min);
      [activePersona] = await db.insert(personas).values({
        userId: user.id,
        name: String(p.name || 'Alex'),
        gender: String(p.gender || 'Other'),
        relationship: String(p.relationship || 'Other'),
        personality: String(p.traits || ''),
        textingStyle: String(p.style || ''),
        replyMin: min,
        replyMax: max,
        replyMode: p.cadenceMode === 'instant' ? 'instant' : 'range',
        dna: p.analysis ? { analysis: p.analysis } : null,
      }).returning();
    }

    let conversationId = body.conversationId as string | undefined;
    if (conversationId) {
      const [ownedConversation] = await db.select().from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, user.id), eq(conversations.personaId, activePersona.id))).limit(1);
      if (!ownedConversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    } else {
      const [conversation] = await db.insert(conversations).values({ userId: user.id, personaId: activePersona.id, title: 'New conversation' }).returning();
      conversationId = conversation.id;
    }

    const [memoryRows, historyRows, pendingRows] = await Promise.all([
      db.select().from(personaMemories).where(eq(personaMemories.personaId, activePersona.id)).orderBy(asc(personaMemories.importance), asc(personaMemories.createdAt)),
      db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)),
      db.select().from(scheduledMessages).where(and(eq(scheduledMessages.conversationId, conversationId), eq(scheduledMessages.status, 'pending'))).orderBy(asc(scheduledMessages.scheduledAt)),
    ]);

    const history = [
      ...historyRows.slice(-80).map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content })),
      ...pendingRows.map(m => ({ role: 'assistant' as const, content: m.reply })),
    ];
    const memories = memoryRows.slice(-40).map(m => `- ${m.memory}`).join('\n') || 'No durable memories learned yet.';
    const dna = activePersona.dna ? JSON.stringify(activePersona.dna) : 'No extracted DNA yet.';

    const system = `You are Echo, a clearly labeled AI simulation based on user-provided persona controls, screenshot evidence, conversation history, and learned memories. Never claim to be the real person. Recreate observable communication behavior, not identity.

PERSONA CONTROLS (authoritative):
- Name: ${activePersona.name}
- Gender: ${activePersona.gender}
- Relationship: ${activePersona.relationship}
- Personality: ${activePersona.personality}
- Texting style: ${activePersona.textingStyle}

OBSERVED PERSONA DNA:
${dna}

DURABLE MEMORIES LEARNED FROM THIS CONVERSATION:
${memories}

RESPONSE PRIORITY:
1. Explicit persona controls.
2. Durable memories and facts established in conversation.
3. Observed DNA and repeated patterns from screenshots.
4. Recent conversation context, including messages that are still waiting to be delivered.
5. General language fluency.

TEXTING BEHAVIOR:
- Reply in the same language as the latest user message unless evidence clearly shows otherwise.
- Match casing, punctuation, slang, emoji habits, message length, line breaks and emotional temperature.
- Do not answer every user message mechanically one-for-one. Read the whole recent exchange and respond to what naturally deserves a response.
- The person can send multiple short texts in one turn. When natural, output 2–4 short message bubbles separated by a blank line. Do not number them and do not force one reply per user message.
- A multi-message reply can react to several points, continue a thought, correct itself, add an afterthought, or simply feel like normal texting. It does not need to mirror the number or order of the user's messages.
- If the persona is terse, keep it terse. If they pause, tease, soften, use slang, lowercase or fragments, reproduce that naturally.
- Do not over-explain, therapize, moralize, or sound like an assistant.
- Do not invent biographical facts. When a fact has been explicitly established in the conversation, keep it consistent later.
- Output only the simulated person's message(s), with no labels or explanations.`;

    const result = await generateText({
      model: google(process.env.GEMINI_MODEL || 'gemini-3.6-flash'),
      system,
      messages: [...history, { role: 'user', content: text }],
      maxOutputTokens: 350,
    });

    const reply = result.text?.trim() || '…';

    await db.insert(messages).values({ conversationId, role: 'user', content: text });

    // Extract only durable facts explicitly established by the exchange.
    // These are stored separately so they survive beyond the recent-message window.
    try {
      const memoryResult = await generateText({
        model: google(process.env.GEMINI_MODEL || 'gemini-3.6-flash'),
        system: `Extract durable facts about the simulated person from the conversation below. Only keep facts that are explicitly stated or clearly established, such as job, study, city, family, preferences, recurring plans, or relationship facts. Do not infer personality. Return zero or more short facts, one per line, with no bullets, numbering, commentary, or headings. If there are no durable facts, return NONE.`,
        messages: [...history.slice(-40), { role: 'user', content: text }, { role: 'assistant', content: reply }],
        maxOutputTokens: 180,
      });
      const extracted = memoryResult.text?.trim() || '';
      if (extracted && extracted !== 'NONE') {
        const existing = memoryRows.map(m => m.memory.toLowerCase());
        for (const raw of extracted.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 5)) {
          const memory = raw.replace(/^[-*•]\s*/, '').trim();
          if (memory.length >= 4 && !existing.includes(memory.toLowerCase())) {
            await db.insert(personaMemories).values({ personaId: activePersona.id, memory, importance: 2 });
          }
        }
      }
    } catch (memoryError) {
      console.warn('Memory extraction skipped:', memoryError);
    }

    const minSec = clamp(activePersona.replyMin, 10, 3600);
    const maxSec = Math.max(minSec, clamp(activePersona.replyMax, 10, 3600));
    const delayMs = activePersona.replyMode === 'instant' ? 0 : Math.floor((minSec + Math.random() * (maxSec - minSec)) * 1000);
    const scheduledAt = new Date(Date.now() + delayMs);
    const [scheduled] = await db.insert(scheduledMessages).values({ userId: user.id, conversationId, reply, scheduledAt }).returning();
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

    return NextResponse.json({ reply, delayMs, scheduledAt: scheduled.scheduledAt, scheduledMessageId: scheduled.id, conversationId, personaId: activePersona.id });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: error instanceof Error ? `Chat failed: ${error.message}` : 'Chat failed' }, { status: 500 });
  }
}
