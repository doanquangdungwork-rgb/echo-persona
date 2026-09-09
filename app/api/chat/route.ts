import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { auth } from '@clerk/nextjs/server';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { conversations, messages, personas, scheduledMessages } from '@/db/schema';
import { getOrCreateUser } from '@/lib/current-user';

function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)); }

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await getOrCreateUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'OPENAI_API_KEY is missing from the deployment.' }, { status: 500 });

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

    const historyRows = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
    const pendingRows = await db.select().from(scheduledMessages).where(and(eq(scheduledMessages.conversationId, conversationId), eq(scheduledMessages.status, 'pending'))).orderBy(asc(scheduledMessages.scheduledAt));
    const history = [...historyRows.slice(-24).map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content })), ...pendingRows.map(m => ({ role: 'assistant' as const, content: m.reply }))];
    const dna = activePersona.dna ? JSON.stringify(activePersona.dna) : 'No extracted DNA yet.';

    const system = `You are Echo, a clearly labeled AI simulation based on user-provided persona controls and conversation evidence. Never claim to be the real person. Recreate observable communication behavior, not identity.\n\nPERSONA CONTROLS (user-provided and authoritative):\n- Name: ${activePersona.name}\n- Gender: ${activePersona.gender}\n- Relationship: ${activePersona.relationship}\n- Personality: ${activePersona.personality}\n- Texting style: ${activePersona.textingStyle}\n\nOBSERVED PERSONA DNA (evidence from screenshots):\n${dna}\n\nRESPONSE PRIORITY:\n1. Follow the user's explicit persona controls.\n2. Follow observed DNA and repeated conversation patterns.\n3. Use recent conversation context.\n4. Only then use general language fluency.\n\nRules:\n- Reply in the same language as the latest user message unless the persona evidence clearly shows otherwise.\n- Treat the persona name as the simulated person's identity label inside this simulation; do not turn it into a third person when context indicates the user is talking to the persona.\n- Match casing, punctuation, slang, emoji habits, message length, line breaks and emotional temperature.\n- Respect the requested personality and relationship. If the persona is terse, stay terse. If the persona uses lowercase or slang, use it naturally.\n- Do not over-explain, therapize, moralize, or sound like an assistant.\n- Do not invent biographical facts that are not in the provided context.\n- Output only the simulated person's message, with no labels or explanations.`;

    const result = await generateText({
      model: openai(process.env.OPENAI_MODEL || 'gpt-5.4-mini'),
      system,
      messages: [...history, { role: 'user', content: text }],
      temperature: 0.85,
      maxOutputTokens: 250,
    });

    const reply = result.text?.trim() || '…';
    const minSec = clamp(activePersona.replyMin, 10, 3600);
    const maxSec = Math.max(minSec, clamp(activePersona.replyMax, 10, 3600));
    const delayMs = Math.floor((minSec + Math.random() * (maxSec - minSec)) * 1000);
    await db.insert(messages).values({ conversationId, role: 'user', content: text });
    const scheduledAt = new Date(Date.now() + delayMs);
    const [scheduled] = await db.insert(scheduledMessages).values({ userId: user.id, conversationId, reply, scheduledAt }).returning();
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

    return NextResponse.json({ reply, delayMs, scheduledAt: scheduled.scheduledAt, scheduledMessageId: scheduled.id, conversationId, personaId: activePersona.id });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: error instanceof Error ? `Chat failed: ${error.message}` : 'Chat failed' }, { status: 500 });
  }
}
