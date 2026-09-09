'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';

type Message = { id: string | number; role: 'user' | 'assistant'; text: string; time: string; delayed?: boolean };
type Persona = { id?: string; name: string; gender: string; relationship: string; traits: string; style: string; cadenceMin: number; cadenceMax: number; cadenceMode: 'range' | 'instant'; analysis: any };
type Project = { id: string; name: string; gender: string; relationship: string; personality: string; textingStyle: string; replyMin: number; replyMax: number; replyMode?: 'range' | 'instant'; dna: any; screenshotCount: number };
type Screenshot = { id: string; url: string; pathname: string; sizeBytes: number; createdAt: string };

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
  const [persona, setPersona] = useState<Persona>(defaults);
  const [projects, setProjects] = useState<Project[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
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
  const [loadingProject, setLoadingProject] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const outgoingBufferRef = useRef<string[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const chatQueueRef = useRef<Promise<void>>(Promise.resolve());

  const cadence = useMemo(() => persona.cadenceMode === 'instant' ? 'Instant' : `${formatDelay(persona.cadenceMin)} — ${formatDelay(persona.cadenceMax)}`, [persona.cadenceMin, persona.cadenceMax, persona.cadenceMode]);

  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  async function loadProjectAssets(projectId: string) {
    setLoadingProject(true);
    try {
      const [shotData, conversationData] = await Promise.all([
        readJson(await fetch(`/api/personas/${projectId}/screenshots`)),
        readJson(await fetch('/api/conversations')),
      ]);
      setScreenshots(shotData.screenshots || []);
      const last = conversationData?.conversations?.find((x: any) => x.personaId === projectId);
      if (last) {
        const detail = await readJson(await fetch(`/api/conversations/${last.id}`));
        setConversationId(detail.conversation.id);
        conversationIdRef.current = detail.conversation.id;
        setMessages(detail.messages.map((m: any) => ({ id: m.id, role: m.role === 'assistant' ? 'assistant' : 'user', text: m.content, time: formatTime(m.createdAt), delayed: Boolean(m.delayMs) })));
      } else {
        setConversationId(undefined);
        conversationIdRef.current = undefined;
        setMessages([]);
      }
    } catch (e: any) { setError(e?.message || 'Could not load this Echo project.'); }
    finally { setLoadingProject(false); }
  }

  async function loadProjects(selectFirst = true) {
    const data = await readJson(await fetch('/api/personas'));
    const nextProjects: Project[] = data?.personas || [];
    setProjects(nextProjects);
    if (selectFirst && nextProjects.length) {
      const first = nextProjects[0];
      setPersona({ id: first.id, name: first.name, gender: first.gender, relationship: first.relationship, traits: first.personality, style: first.textingStyle, cadenceMin: first.replyMin, cadenceMax: first.replyMax, cadenceMode: first.replyMode || 'range', analysis: first.dna });
      setAnalysisComplete(first.screenshotCount > 0);
      await loadProjectAssets(first.id);
    }
  }

  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      try { await loadProjects(true); }
      catch (e: any) { setError(e?.message || 'Could not load your saved Echo projects.'); }
      finally { setHydrated(true); }
    })();
  }, [isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !hydrated || !persona.id) return;
    setSaved(false); setSaving(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await readJson(await fetch('/api/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) }));
        setProjects(prev => prev.map(p => p.id === persona.id ? { ...p, name: persona.name, gender: persona.gender, relationship: persona.relationship, personality: persona.traits, textingStyle: persona.style, replyMin: persona.cadenceMin, replyMax: persona.cadenceMax, replyMode: persona.cadenceMode } : p));
        setSaved(true);
      } catch (e: any) { setError(e?.message || 'Could not save persona settings.'); }
      finally { setSaving(false); }
    }, 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [persona.name, persona.gender, persona.relationship, persona.traits, persona.style, persona.cadenceMin, persona.cadenceMax, persona.cadenceMode, persona.id, isSignedIn, hydrated]);

  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);
  useEffect(() => () => { if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current); }, []);

  function updatePersona(patch: Partial<Persona>) { setPersona(p => ({ ...p, ...patch })); }

  function handleFiles(selected: FileList | null) {
    const incoming = Array.from(selected || []).filter(f => f.type.startsWith('image/'));
    const available = Math.max(0, 20 - screenshots.length - files.length);
    const next = incoming.slice(0, available);
    setFiles(prev => [...prev, ...next]);
    setPreviews(prev => [...prev, ...next.map(file => URL.createObjectURL(file))]);
    setAnalysisComplete(false);
    if (incoming.length > next.length || Array.from(selected || []).length > incoming.length) setError('Only image files are supported. Maximum 20 screenshots per project.');
    else setError('');
  }

  function removeFile(index: number) {
    URL.revokeObjectURL(previews[index]);
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
    setAnalysisComplete(false);
  }

  async function savePersonaNow() {
    const data = await readJson(await fetch('/api/personas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) }));
    const created = data.persona;
    if (created?.id) {
      const nextPersona = { ...persona, id: created.id };
      setPersona(nextPersona);
      setProjects(prev => [{ ...created, screenshotCount: 0 }, ...prev]);
      return nextPersona;
    }
    return persona;
  }

  async function analyze() {
    if (!files.length || analyzing) return;
    setAnalyzing(true); setAnalysisComplete(false); setError('');
    try {
      const currentPersona = persona.id ? persona : await savePersonaNow();
      if (!currentPersona.id) throw new Error('Could not create the Echo project.');
      const form = new FormData();
      form.append('personaId', currentPersona.id);
      files.forEach(file => form.append('files', file));
      const uploaded = await readJson(await fetch('/api/uploads', { method: 'POST', body: form }));
      const result = await readJson(await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona: currentPersona, screenshotIds: uploaded.screenshotIds || [] }) }));
      setPersona(p => ({ ...p, ...result.persona, cadenceMode: result.persona.cadenceMode || p.cadenceMode, analysis: result.persona.analysis }));
      setFiles([]); previews.forEach(url => URL.revokeObjectURL(url)); setPreviews([]);
      setSaved(true); setAnalysisComplete(true); setTab('persona');
      await loadProjects(false); await loadProjectAssets(currentPersona.id);
    } catch (e: any) { setError(e?.message || 'Could not analyze the screenshots.'); }
    finally { setAnalyzing(false); }
  }

  async function selectProject(project: Project) {
    if (!project.id || project.id === persona.id) return;
    setPersona({ id: project.id, name: project.name, gender: project.gender, relationship: project.relationship, traits: project.personality, style: project.textingStyle, cadenceMin: project.replyMin, cadenceMax: project.replyMax, cadenceMode: project.replyMode || 'range', analysis: project.dna });
    setFiles([]); previews.forEach(url => URL.revokeObjectURL(url)); setPreviews([]);
    setAnalysisComplete(project.screenshotCount > 0); setError(''); setTab('persona');
    await loadProjectAssets(project.id);
  }

  function startNewProject() {
    setPersona({ ...defaults, id: undefined, analysis: null });
    setScreenshots([]); setMessages([]); setConversationId(undefined); conversationIdRef.current = undefined;
    setFiles([]); previews.forEach(url => URL.revokeObjectURL(url)); setPreviews([]);
    setAnalysisComplete(false); setError(''); setSaved(false); setTab('persona');
  }

  async function deleteStoredScreenshot(id: string) {
    if (!persona.id) return;
    try {
      await readJson(await fetch(`/api/personas/${persona.id}/screenshots`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenshotId: id }) }));
      setScreenshots(prev => prev.filter(s => s.id !== id));
      setProjects(prev => prev.map(p => p.id === persona.id ? { ...p, screenshotCount: Math.max(0, p.screenshotCount - 1) } : p));
      setAnalysisComplete(false);
    } catch (e: any) { setError(e?.message || 'Could not remove this screenshot.'); }
  }

  async function deleteProject() {
    if (!persona.id) return;
    const id = persona.id;
    try {
      await readJson(await fetch(`/api/personas/${id}`, { method: 'DELETE' }));
      const remaining = projects.filter(p => p.id !== id);
      setProjects(remaining);
      if (remaining.length) await selectProject(remaining[0]); else startNewProject();
    } catch (e: any) { setError(e?.message || 'Could not delete this project.'); }
  }

  function queueChatRequest(batch: string[]) {
    setPendingReplies(n => n + 1);
    chatQueueRef.current = chatQueueRef.current.then(async () => {
      try {
        const d = await readJson(await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: batch, persona, conversationId: conversationIdRef.current }) }));
        setConversationId(d.conversationId); conversationIdRef.current = d.conversationId; setPersona(p => ({ ...p, id: d.personaId }));
        const delay = d.delayMs || 0;
        window.setTimeout(() => { setMessages(m => [...m, { id: `assistant-${Date.now()}-${Math.random()}`, role: 'assistant', text: d.reply, time: 'just now', delayed: delay > 0 }]); setPendingReplies(n => Math.max(0, n - 1)); }, delay);
      } catch (e: any) {
        setMessages(m => [...m, { id: `error-${Date.now()}`, role: 'assistant', text: e?.message || 'Something went wrong.', time: 'now' }]);
        setPendingReplies(n => Math.max(0, n - 1)); setError(e?.message || 'Could not connect to the backend.');
      }
    });
  }

  function send() {
    const text = input.trim(); if (!text) return;
    setInput(''); setError(''); setMessages(m => [...m, { id: `local-${Date.now()}-${Math.random()}`, role: 'user', text, time: 'now' }]);
    outgoingBufferRef.current.push(text);
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => { const batch = outgoingBufferRef.current.splice(0, 8); if (batch.length) queueChatRequest(batch); }, 900);
  }

  if (!isLoaded) return <div className="auth-gate"><div className="auth-card"><div className="brand"><span className="mark">e</span><div><b>echo</b><small>persona studio</small></div></div><p>Loading your studio…</p></div></div>;
  if (!isSignedIn) return <main className="auth-gate"><div className="auth-card"><div className="brand"><span className="mark">e</span><div><b>echo</b><small>persona studio</small></div></div><h1>Your conversations,<br /><i>kept yours.</i></h1><p>Sign in to save personas, conversations and memories securely to your Echo account.</p><SignInButton mode="modal"><button className="primary">Sign in to Echo <span>→</span></button></SignInButton></div></main>;

  return <main>
    <aside className="sidebar">
      <div className="brand"><span className="mark">e</span><div><b>echo</b><small>persona studio</small></div></div>
      <div className="project-head"><div><div className="side-title">Your projects</div><small>Each project keeps its own evidence + memory.</small></div><button type="button" className="new-project" onClick={startNewProject}>+ New</button></div>
      <div className="projects-list">
        {projects.length === 0 && <div className="projects-empty">No saved projects yet.<br />Import a conversation to create one.</div>}
        {projects.map(project => <button type="button" key={project.id} className={`project-row ${project.id === persona.id ? 'active' : ''}`} onClick={() => selectProject(project)}><span className="project-avatar">{project.name[0]?.toUpperCase()}</span><span className="project-copy"><b>{project.name}</b><small>{project.relationship} · {project.screenshotCount} screenshot{project.screenshotCount === 1 ? '' : 's'}</small></span><span className="project-arrow">{project.id === persona.id ? '●' : '›'}</span></button>)}
      </div>
      <div className="side-title">{persona.id ? 'Edit project' : 'New project'}</div>
      <div className="upload">
        <div className="upload-icon">⌁</div><strong>Conversation evidence</strong>
        <p>Stored inside this project. Add more screenshots anytime to strengthen the persona, or remove old evidence and re-interpret.</p>
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => handleFiles(e.target.files)} />
        {screenshots.length > 0 && <><div className="file-count">Stored evidence · {screenshots.length}</div><div className="stored-previews">{screenshots.map(s => <div className="stored-preview" key={s.id}><img src={`${s.url}?v=${encodeURIComponent(s.createdAt)}`} alt="" /><button type="button" onClick={() => deleteStoredScreenshot(s.id)}>×</button></div>)}</div></>}
        {files.length > 0 && <><div className="file-count">New evidence · {files.length}</div><div className="file-previews">{previews.map((src, i) => <div className="file-preview" key={src}><img src={src} alt="" /><button type="button" onClick={() => removeFile(i)}>×</button></div>)}</div></>}
        <button className="ghost" disabled={!files.length || analyzing} onClick={analyze}>{analyzing ? 'Interpreting the project…' : files.length ? `Add & interpret ${files.length} screenshot${files.length > 1 ? 's' : ''}` : 'Add screenshots'}</button>
        {analysisComplete && !analyzing && <div className="interpret-done"><span>✓</span><div><b>Project interpreted</b><small>New evidence is part of the persona model.</small></div></div>}
      </div>
      <div className="divider" />
      <label>Name<input value={persona.name} onChange={e => updatePersona({ name: e.target.value })} /></label>
      <div className="row"><label>Gender<select value={persona.gender} onChange={e => updatePersona({ gender: e.target.value })}><option>Male</option><option>Female</option><option>Non-binary</option><option>Other</option></select></label><label>Relationship<select value={persona.relationship} onChange={e => updatePersona({ relationship: e.target.value })}><option>Ex-partner</option><option>Partner</option><option>Friend</option><option>Other</option></select></label></div>
      <label>Personality<input value={persona.traits} onChange={e => updatePersona({ traits: e.target.value })} placeholder="e.g. calm, dry, caring indirectly" /></label>
      <label>Texting style<textarea rows={3} value={persona.style} onChange={e => updatePersona({ style: e.target.value })} placeholder="e.g. lowercase, short replies, uses 'ừ' and '=))'" /></label>
      <div className="cadence">
        <div className="cadence-head"><span>Reply cadence</span><b>{cadence}</b></div>
        <div className="cadence-modes"><button type="button" className={persona.cadenceMode === 'range' ? 'active' : ''} onClick={() => updatePersona({ cadenceMode: 'range' })}>Adjust range</button><button type="button" className={persona.cadenceMode === 'instant' ? 'active' : ''} onClick={() => updatePersona({ cadenceMode: 'instant' })}>Instant respond</button></div>
        {persona.cadenceMode === 'range' && <><div className="range-wrap"><div className="range-track" /><div className="range-fill" style={{ left: `${Math.max(0, Math.min(100, ((persona.cadenceMin - 10) / 3590) * 100))}%`, right: `${Math.max(0, Math.min(100, 100 - ((persona.cadenceMax - 10) / 3590) * 100))}%` }} /><input aria-label="Minimum reply delay" type="range" min="10" max="3600" value={persona.cadenceMin} onChange={e => updatePersona({ cadenceMin: Math.min(Number(e.target.value), persona.cadenceMax) })} /><input aria-label="Maximum reply delay" type="range" min="10" max="3600" value={persona.cadenceMax} onChange={e => updatePersona({ cadenceMax: Math.max(Number(e.target.value), persona.cadenceMin) })} /></div><div className="range-values"><span>MIN <b>{formatDelay(persona.cadenceMin)}</b></span><span>MAX <b>{formatDelay(persona.cadenceMax)}</b></span></div></>}
        <small>{persona.cadenceMode === 'instant' ? 'Replies appear immediately.' : 'Replies are naturally randomized inside this window.'}</small>
      </div>
      {persona.id && <button type="button" className="delete-project" onClick={deleteProject}>Delete this project</button>}
      <div className={`save-status ${saved ? 'saved' : ''}`}>{saving ? 'Saving changes…' : saved ? '✓ Project saved' : 'Changes not saved yet'}</div>
      {error && <div className="error-box">{error}</div>}
      <div className="disclaimer">Simulation only · the bot is an AI reconstruction, not the actual person.</div>
    </aside>
    <section className="workspace">
      <header><div className="tabs"><button className={tab === 'persona' ? 'active' : ''} onClick={() => setTab('persona')}>Persona</button><button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Conversation</button></div><div className={`status ${analyzing || saving || loadingProject ? 'working' : analysisComplete ? 'ready' : ''}`}><span /> {analyzing ? 'Reading your conversation' : loadingProject ? 'Opening your project' : saving ? 'Saving your changes' : analysisComplete ? 'Your conversation is understood' : 'Echo is ready'}</div></header>
      {analyzing && <div className="analysis-banner"><div className="pulse" /><div><strong>Reading the conversation</strong><span>Finding patterns, tone, habits and the details that make them feel like them.</span></div></div>}
      {tab === 'persona' ? <div className="intro"><div className="eyebrow">01 / PERSONA</div><h1>Some people leave<br /><i>a rhythm behind.</i></h1><p>Echo turns the traces in your conversations into a living communication pattern. Not just what they say, but how they pause, react, soften, tease and remember.</p><div className="quote-card"><span>THE SIGNAL</span><p>“It should feel like a person you know — not an assistant answering you.”</p></div><div className="preview-card"><div className="avatar">{persona.name[0]?.toUpperCase()}</div><div><b>{persona.name}</b><span>{persona.relationship} · {persona.gender}</span></div><em>{cadence}</em></div><button className="primary" onClick={() => setTab('chat')}>Enter the conversation <span>→</span></button></div> : <div className="chat-shell"><div className="chat-head"><div className="avatar">{persona.name[0]?.toUpperCase()}</div><div><b>{persona.name}</b><span>AI reconstruction · {persona.relationship}</span></div><div className="cadence-pill">{persona.cadenceMode === 'instant' ? 'instant' : `reply rhythm · ${cadence}`}</div></div><div className="messages">{messages.length === 0 && <div className="empty-chat"><strong>Say something you would normally say.</strong><span>Echo reads your messages as a conversation, not isolated prompts.</span></div>}{messages.map(m => <div key={m.id} className={'message ' + m.role}>{(m.role === 'assistant' ? m.text.split(/\n\s*\n/).filter(Boolean) : [m.text]).map((part, i) => <div className="bubble" key={`${m.id}-${i}`}>{part}</div>)}<span>{m.time}{m.delayed ? ' · delayed' : ''}</span></div>)}{pendingReplies > 0 && <div className="message assistant"><div className="typing"><i /><i /><i /></div><span>finding the right rhythm</span></div>}</div><div className="composer"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="say something…" /><button onClick={send} disabled={!input.trim()}>↑</button><small>Messages sent close together are read as one turn · Enter to send</small></div></div>}
    </section>
    <div className="corner-status">{analyzing ? <><i className="spinner" /> Interpreting conversation…</> : saving ? <><i className="spinner" /> Saving project…</> : analysisComplete ? <><i className="check-dot">✓</i> Persona ready</> : saved ? <><i className="check-dot">✓</i> Synced</> : null}</div>
    <div className="account"><UserButton /></div>
  </main>;
}
