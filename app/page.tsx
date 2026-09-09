'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';

type Message = { id: string | number; role: 'user' | 'assistant'; text: string; time: string; delayed?: boolean };
type Persona = { id?: string; name: string; gender: string; relationship: string; traits: string; style: string; cadenceMin: number; cadenceMax: number; cadenceMode: 'range' | 'instant'; analysis: any };

const defaults: Persona = { name: 'Alex', gender: 'Male', relationship: 'Ex-partner', traits: 'Warm, slightly teasing, thoughtful', style: 'Casual Vietnamese texting, short messages, lowercase sometimes, natural pauses', cadenceMin: 30, cadenceMax: 600, cadenceMode: 'range', analysis: null };

function formatDelay(sec: number) { if (sec < 60) return `${Math.round(sec)}s`; const m = Math.floor(sec / 60); return `${m}m`; }
function formatTime(value: string | Date) { const d = new Date(value); if (Number.isNaN(d.getTime())) return 'now'; return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

async function readJson(response: Response) {
  const raw = await response.text();
  if (!raw.trim()) throw new Error(`Request failed (${response.status}): server returned an empty response.`);
  try {
    const data = JSON.parse(raw);
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
    return data;
  } catch (error) {
    if (error instanceof Error && !error.message.includes('Unexpected token')) throw error;
    throw new Error(`Request failed (${response.status}): server returned invalid JSON.`);
  }
}

export default function Home() {
  const { isLoaded, isSignedIn } = useUser();
  const [persona, setPersona] = useState(defaults);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string>();
  const [pendingReplies, setPendingReplies] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [tab, setTab] = useState<'persona' | 'chat'>('persona');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const cadence = useMemo(() => persona.cadenceMode === 'instant' ? 'Instant' : `${formatDelay(persona.cadenceMin)} — ${formatDelay(persona.cadenceMax)}`, [persona.cadenceMin, persona.cadenceMax, persona.cadenceMode]);

  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      try {
        const data = await readJson(await fetch('/api/personas'));
        const first = data?.personas?.[0];
        if (!first) { setHydrated(true); return; }
        const next: Persona = { id: first.id, name: first.name, gender: first.gender, relationship: first.relationship, traits: first.personality, style: first.textingStyle, cadenceMin: first.replyMin, cadenceMax: first.replyMax, cadenceMode: first.replyMode || 'range', analysis: first.dna };
        setPersona(next);
        const c = await readJson(await fetch('/api/conversations'));
        const last = c?.conversations?.find((x: any) => x.personaId === first.id);
        if (last) {
          const detail = await readJson(await fetch(`/api/conversations/${last.id}`));
          setConversationId(detail.conversation.id);
          setMessages(detail.messages.map((m: any) => ({ id: m.id, role: m.role === 'assistant' ? 'assistant' : 'user', text: m.content, time: formatTime(m.createdAt), delayed: Boolean(m.delayMs) })));
        }
      } catch (e: any) { setError(e?.message || 'Could not load your saved Echo data.'); }
      finally { setHydrated(true); }
    })();
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !hydrated) return;
    setSaved(false);
    setSaving(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const data = await readJson(await fetch('/api/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) }));
        if (!persona.id && data.persona?.id) setPersona(p => ({ ...p, id: data.persona.id }));
        setSaved(true);
      } catch (e: any) { setError(e?.message || 'Could not save persona settings.'); }
      finally { setSaving(false); }
    }, 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [persona.name, persona.gender, persona.relationship, persona.traits, persona.style, persona.cadenceMin, persona.cadenceMax, persona.cadenceMode, isSignedIn, hydrated]);

  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);

  function updatePersona(patch: Partial<Persona>) { setPersona(p => ({ ...p, ...patch })); }

  function handleFiles(selected: FileList | null) {
    const incoming = Array.from(selected || []);
    const next = incoming.filter(f => f.type.startsWith('image/')).slice(0, 20);
    previews.forEach(url => URL.revokeObjectURL(url));
    setFiles(next);
    setPreviews(next.map(file => URL.createObjectURL(file)));
    setAnalysisComplete(false);
    setError(next.length < incoming.length ? 'Only image files are supported. Maximum 20 screenshots.' : '');
  }

  function removeFile(index: number) {
    const nextFiles = files.filter((_, i) => i !== index);
    const nextPreviews = previews.filter((_, i) => i !== index);
    URL.revokeObjectURL(previews[index]);
    setFiles(nextFiles);
    setPreviews(nextPreviews);
    setAnalysisComplete(false);
  }

  async function savePersonaNow() {
    const data = await readJson(await fetch('/api/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) }));
    if (data.persona?.id && data.persona.id !== persona.id) setPersona(p => ({ ...p, id: data.persona.id }));
    return data.persona;
  }

  async function analyze() {
    if (!files.length || analyzing) return;
    setAnalyzing(true); setAnalysisComplete(false); setError('');
    try {
      const currentPersona = persona.id ? persona : { ...(await savePersonaNow()), analysis: persona.analysis, traits: persona.traits, style: persona.style, cadenceMin: persona.cadenceMin, cadenceMax: persona.cadenceMax, cadenceMode: persona.cadenceMode } as Persona;
      if (!persona.id && currentPersona.id) setPersona(p => ({ ...p, id: currentPersona.id }));
      const form = new FormData();
      files.forEach(file => form.append('files', file));
      const uploaded = await readJson(await fetch('/api/uploads', { method: 'POST', body: form }));
      const ids = uploaded.screenshotIds || [];
      const result = await readJson(await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenshotIds: ids, persona: currentPersona }) }));
      setPersona(p => ({ ...p, ...result.persona, cadenceMode: result.persona.cadenceMode || p.cadenceMode, analysis: result.persona.analysis }));
      setFiles([]);
      previews.forEach(url => URL.revokeObjectURL(url));
      setPreviews([]);
      setSaved(true);
      setAnalysisComplete(true);
      setTab('persona');
    } catch (e: any) {
      setError(e?.message || 'Could not analyze the screenshots.');
    } finally { setAnalyzing(false); }
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput(''); setError('');
    setMessages(m => [...m, { id: `local-${Date.now()}-${Math.random()}`, role: 'user', text, time: 'now' }]);
    setPendingReplies(n => n + 1);
    try {
      const d = await readJson(await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, persona, conversationId }) }));
      setConversationId(d.conversationId);
      setPersona(p => ({ ...p, id: d.personaId }));
      const delay = d.delayMs || 0;
      window.setTimeout(() => {
        setMessages(m => [...m, { id: `assistant-${Date.now()}-${Math.random()}`, role: 'assistant', text: d.reply, time: 'just now', delayed: delay > 0 }]);
        setPendingReplies(n => Math.max(0, n - 1));
      }, delay);
    } catch (e: any) {
      setMessages(m => [...m, { id: `error-${Date.now()}`, role: 'assistant', text: e?.message || 'Something went wrong.', time: 'now' }]);
      setPendingReplies(n => Math.max(0, n - 1));
      setError(e?.message || 'Could not connect to the backend.');
    }
  }

  if (!isLoaded) return <div className="auth-gate"><div className="auth-card"><div className="brand"><span className="mark">e</span><div><b>echo</b><small>persona studio</small></div></div><p>Loading your studio…</p></div></div>;
  if (!isSignedIn) return <main className="auth-gate"><div className="auth-card"><div className="brand"><span className="mark">e</span><div><b>echo</b><small>persona studio</small></div></div><h1>Your conversations,<br /><i>kept yours.</i></h1><p>Sign in to save personas, conversations and memories securely to your Echo account.</p><SignInButton mode="modal"><button className="primary">Sign in to Echo <span>→</span></button></SignInButton></div></main>;

  return <main>
    <aside className="sidebar">
      <div className="brand"><span className="mark">e</span><div><b>echo</b><small>persona studio</small></div></div>
      <div className="side-title">Create a person</div>
      <div className="upload">
        <div className="upload-icon">⌁</div>
        <strong>Import your chat</strong>
        <p>Upload multiple screenshots. Echo reads them as one behavioral evidence set.</p>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => handleFiles(e.target.files)} />
        {files.length > 0 && <>
          <div className="file-count">{files.length} screenshot{files.length > 1 ? 's' : ''} selected</div>
          <div className="file-previews">{previews.map((src, i) => <div className="file-preview" key={src}><img src={src} alt="" /><button type="button" onClick={() => removeFile(i)}>×</button></div>)}</div>
        </>}
        <button className="ghost" disabled={!files.length || analyzing} onClick={analyze}>{analyzing ? 'Interpreting your conversation…' : files.length ? `Interpret ${files.length} screenshot${files.length > 1 ? 's' : ''}` : 'Choose screenshots'}</button>
        {analysisComplete && !analyzing && <div className="interpret-done"><span>✓</span><div><b>Conversation interpreted</b><small>Echo is ready to talk.</small></div></div>}
      </div>
      <div className="divider" />
      <label>Name<input value={persona.name} onChange={e => updatePersona({ name: e.target.value })} /></label>
      <div className="row"><label>Gender<select value={persona.gender} onChange={e => updatePersona({ gender: e.target.value })}><option>Male</option><option>Female</option><option>Non-binary</option><option>Other</option></select></label><label>Relationship<select value={persona.relationship} onChange={e => updatePersona({ relationship: e.target.value })}><option>Ex-partner</option><option>Partner</option><option>Friend</option><option>Other</option></select></label></div>
      <label>Personality<input value={persona.traits} onChange={e => updatePersona({ traits: e.target.value })} placeholder="e.g. calm, dry, caring indirectly" /></label>
      <label>Texting style<textarea rows={3} value={persona.style} onChange={e => updatePersona({ style: e.target.value })} placeholder="e.g. lowercase, short replies, uses 'ừ' and '=))'" /></label>
      <div className="cadence">
        <div className="cadence-head"><span>Reply cadence</span><b>{cadence}</b></div>
        <div className="cadence-modes">
          <button type="button" className={persona.cadenceMode === 'range' ? 'active' : ''} onClick={() => updatePersona({ cadenceMode: 'range' })}>Adjust range</button>
          <button type="button" className={persona.cadenceMode === 'instant' ? 'active' : ''} onClick={() => updatePersona({ cadenceMode: 'instant' })}>Instant respond</button>
        </div>
        {persona.cadenceMode === 'range' && <>
          <div className="range-wrap"><div className="range-track" /><div className="range-fill" style={{ left: `${Math.max(0, Math.min(100, ((persona.cadenceMin - 10) / 3590) * 100))}%`, right: `${Math.max(0, Math.min(100, 100 - ((persona.cadenceMax - 10) / 3590) * 100))}%` }} /><input aria-label="Minimum reply delay" type="range" min="10" max="3600" value={persona.cadenceMin} onChange={e => updatePersona({ cadenceMin: Math.min(Number(e.target.value), persona.cadenceMax) })} /><input aria-label="Maximum reply delay" type="range" min="10" max="3600" value={persona.cadenceMax} onChange={e => updatePersona({ cadenceMax: Math.max(Number(e.target.value), persona.cadenceMin) })} /></div>
          <div className="range-values"><span>MIN <b>{formatDelay(persona.cadenceMin)}</b></span><span>MAX <b>{formatDelay(persona.cadenceMax)}</b></span></div>
        </>}
        <small>{persona.cadenceMode === 'instant' ? 'Replies appear immediately.' : 'Replies are naturally randomized inside this window.'}</small>
      </div>
      <div className={`save-status ${saved ? 'saved' : ''}`}>{saving ? 'Saving changes…' : saved ? '✓ Persona saved' : 'Saving persona…'}</div>
      {error && <div className="error-box">{error}</div>}
      <div className="disclaimer">Simulation only · the bot is an AI reconstruction, not the actual person.</div>
    </aside>
    <section className="workspace">
      <header><div className="tabs"><button className={tab === 'persona' ? 'active' : ''} onClick={() => setTab('persona')}>Persona</button><button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Conversation</button></div><div className={`status ${analyzing || saving ? 'working' : analysisComplete ? 'ready' : ''}`}><span /> {analyzing ? 'Reading your conversation' : saving ? 'Saving your changes' : analysisComplete ? 'Your conversation is understood' : 'Echo is ready'}</div></header>
      {analyzing && <div className="analysis-banner"><div className="pulse" /><div><strong>Reading the conversation</strong><span>Finding patterns, tone, habits and the details that make them feel like them.</span></div></div>}
      {tab === 'persona' ? <div className="intro"><div className="eyebrow">01 / PERSONA</div><h1>Some people leave<br /><i>a rhythm behind.</i></h1><p>Echo turns the traces in your conversations into a living communication pattern. Not just what they say, but how they pause, react, soften, tease and remember.</p><div className="quote-card"><span>THE SIGNAL</span><p>“It should feel like a person you know — not an assistant answering you.”</p></div><div className="preview-card"><div className="avatar">{persona.name[0]?.toUpperCase()}</div><div><b>{persona.name}</b><span>{persona.relationship} · {persona.gender}</span></div><em>{cadence}</em></div><button className="primary" onClick={() => setTab('chat')}>Enter the conversation <span>→</span></button></div> : <div className="chat-shell"><div className="chat-head"><div className="avatar">{persona.name[0]?.toUpperCase()}</div><div><b>{persona.name}</b><span>AI reconstruction · {persona.relationship}</span></div><div className="cadence-pill">{persona.cadenceMode === 'instant' ? 'instant' : `reply rhythm · ${cadence}`}</div></div><div className="messages">{messages.length === 0 && <div className="empty-chat"><strong>Say something you would normally say.</strong><span>Echo learns from the conversation as you go.</span></div>}{messages.map(m => <div key={m.id} className={'message ' + m.role}>{(m.role === 'assistant' ? m.text.split(/\n\s*\n/).filter(Boolean) : [m.text]).map((part, i) => <div className="bubble" key={`${m.id}-${i}`}>{part}</div>)}<span>{m.time}{m.delayed ? ' · delayed' : ''}</span></div>)}{pendingReplies > 0 && <div className="message assistant"><div className="typing"><i /><i /><i /></div><span>finding the right rhythm</span></div>}</div><div className="composer"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="say something…" /><button onClick={send} disabled={!input.trim()}>↑</button><small>Enter to send · you can send several messages before they reply</small></div></div>}
    </section>
    <div className="corner-status">{analyzing ? <><i className="spinner" /> Interpreting conversation…</> : saving ? <><i className="spinner" /> Saving persona…</> : analysisComplete ? <><i className="check-dot">✓</i> Persona ready</> : saved ? <><i className="check-dot">✓</i> Synced</> : null}</div>
    <div className="account"><UserButton /></div>
  </main>;
}
