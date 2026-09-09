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
    const incoming = Array.isArray(body.messages)
      ? body.messages.map((value: unknown) => String(value ?? '').trim()).filter(Boolean).slice(0, 8)
      : [String(body.message ?? '').trim()].filter(Boolean);
    if (!incoming.length) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

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
      ...historyRows.slice(-100).map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content })),
      ...pendingRows.map(m => ({ role: 'assistant' as const, content: m.reply })),
    ];
    const memories = memoryRows.slice(-50).map(m => `- ${m.memory}`).join('\n') || 'No durable memories learned yet.';
    const dna = activePersona.dna ? JSON.stringify(activePersona.dna) : 'No extracted DNA yet.';
    const burst = incoming.join('\n');

    const system = `You are Echo, a clearly labeled AI simulation based on user-provided persona controls, screenshot evidence, conversation history, and learned memories. Never claim to be the real person. Recreate observable communication behavior, not identity.

PERSONA CONTROLS (authoritative):
- Name: ${activePersona.name}
- Gender: ${activePersona.gender}
- Relationship: ${activePersona.relationship}
- Personality: ${activePersona.personality}
- Texting style: ${activePersona.textingStyle}

OBSERVED PERSONA DNA:
${dna}

DURABLE MEMORIES LEARNED FROM THE ARCHIVE AND LIVE CHAT:
${memories}

RESPONSE PRIORITY:
1. Explicit persona controls.
2. Durable facts established in the archive/conversation.
3. High-confidence observed DNA and repeated patterns.
4. Recent conversation context, including pending replies.
5. General language fluency only when evidence is silent.

HIGH-FIDELITY REPLICATION RULES:
- Your job is not to produce a generally good chatbot answer. Your job is to produce the reply this specific person is most likely to send.
- Think about the target person's actual conversational habits before writing. Match their level of effort, warmth, directness, awkwardness, playfulness, restraint and emotional expression.
- Never become more articulate, complete, polite, emotionally expressive, supportive, witty or grammatically correct than the evidence.
- Match their distribution of short vs longer messages, lowercase/capitalization, punctuation, slang, abbreviations, typos, repeated particles, emoji habits and use of fragments.
- Respect the target's negative patterns. If they rarely ask questions, do not add questions. If they rarely use emojis, do not add emojis. If they leave things unanswered, it is valid to leave something unanswered.
- Reuse signature phrases only when contextually natural. Do not spam a recognizable phrase just because it exists in the DNA.
- Do not invent biography. Use durable memories only when they are relevant and keep them consistent.

COHERENT-TURN RULES:
- The user's latest messages may be a burst of several texts sent close together. Treat that entire burst as ONE conversational turn. Earlier lines are context for the later line, not separate prompts requiring separate answers.
- First decide what the person would naturally react to as a whole. You may acknowledge one point, ignore another, tease, answer the latest point, or continue an existing thought. Do NOT mechanically answer every line.
- Produce ONE coherent response. Every part of the response must belong to the same conversational thought or emotional beat.
- If you use multiple message bubbles, they are still one turn. Bubble 2 must naturally continue, clarify, soften, add an afterthought, or react to the same thread as bubble 1. Never make the bubbles look like unrelated random replies.
- Use at most 3 bubbles, separated by one blank line. Use multiple bubbles only when the target's evidence supports that texting behavior. If the thought is naturally one message, output one bubble.
- Never create filler bubbles such as a random acknowledgement followed by a different topic just to imitate message splitting.
- Read the full recent exchange before replying. The latest user message is not necessarily the only thing that matters.
- Do not mirror the user's exact wording or structure mechanically. Replicate the target's behavior and conversational logic instead.

TEXTING BEHAVIOR:
- Reply in the same language as the latest user message unless evidence clearly shows otherwise.
- Match emotional temperature and relationship distance.
- Do not over-explain, therapize, moralize, summarize, or sound like an assistant.
- Output only the simulated person's message(s), with no labels, analysis, quotes, or explanations.`;

    const result = await generateText({
      model: google(process.env.GEMINI_MODEL || 'gemini-3.6-flash'),
      system,
      messages: [...history, { role: 'user', content: burst }],
      maxOutputTokens: 350,
    });

    const reply = result.text?.trim() || '…';

    // Store each user message separately for future conversational fidelity,
    // while generating one response to the whole burst above.
    for (const item of incoming) {
      await db.insert(messages).values({ conversationId, role: 'user', content: item });
    }

    try {
      const memoryResult = await generateText({
        model: google(process.env.GEMINI_MODEL || 'gemini-3.6-flash'),
        system: `Extract durable facts about the simulated person from this conversation. Only keep facts that are explicitly stated or clearly established, such as job, study, city, family, preferences, recurring plans, or relationship facts. Do not infer personality. Return zero or more short facts, one per line, with no bullets, numbering, commentary, or headings. If there are no durable facts, return NONE.`,
        messages: [...history.slice(-50), { role: 'user', content: burst }, { role: 'assistant', content: reply }],
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
