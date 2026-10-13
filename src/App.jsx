import React, { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { configured, supabase } from './lib/supabase'

const ROUND_NAMES = ['Round 1 · Tech Quiz', 'Round 2 · Decode the Clue', 'Round 3 · Campus Hunt', 'Round 4 · Final Code']
const DEFAULT_QUALIFIERS = [15, 10, 3, 1]

function fmtSeconds(value) {
  const s = Math.max(0, Number(value) || 0)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
function errText(err) { return err?.message || String(err || 'Something went wrong') }

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [teamName, setTeamName] = useState('')
  const [teamCode, setTeamCode] = useState('')
  const [authMode, setAuthMode] = useState('signin')
  const [tab, setTab] = useState('play')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(null)
  const [question, setQuestion] = useState(null)
  const [answer, setAnswer] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [teams, setTeams] = useState([])
  const [allAttempts, setAllAttempts] = useState([])
  const [questions, setQuestions] = useState([])
  const [newTeam, setNewTeam] = useState({ name: '', code: '' })
  const [newQuestion, setNewQuestion] = useState({ round_no: 1, prompt: '', options: 'A) Option one\\nB) Option two\\nC) Option three\\nD) Option four', answer: '', points: 10, checkpoint_label: '' })
  const [qrBase, setQrBase] = useState('')

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session || !supabase) { setProfile(null); return }
    let active = true
    supabase.from('profiles').select('id, role, team_id').eq('id', session.user.id).single()
      .then(({ data, error }) => {
        if (!active) return
        if (error) setNotice(error.message)
        setProfile(data || null)
      })
    return () => { active = false }
  }, [session])

  const isAdmin = profile?.role === 'admin'

  async function loadTeamState() {
    if (!supabase || !profile || isAdmin) return
    const { data, error } = await supabase.rpc('get_my_game_state')
    if (error) { setNotice(error.message); return }
    const state = Array.isArray(data) ? data[0] : data
    setAttempt(state?.attempt || null)
    setQuestion(state?.question || null)
    if (state?.attempt?.started_at) {
      const start = new Date(state.attempt.started_at).getTime()
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    }
  }

  useEffect(() => { if (profile && !isAdmin) loadTeamState() }, [profile?.id, profile?.role])
  useEffect(() => {
    if (!attempt?.started_at || attempt?.status !== 'active') return
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [attempt?.started_at, attempt?.status])

  async function signIn(e) {
    e.preventDefault(); setBusy(true); setNotice('')
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { team_name: teamName, team_code: teamCode } } })
        if (error) throw error
        setNotice('Account request submitted. If email confirmation is enabled, confirm your email. Admin must assign your team before play.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e2) { setNotice(errText(e2)) } finally { setBusy(false) }
  }

  async function signOut() { await supabase.auth.signOut(); setProfile(null); setAttempt(null); setQuestion(null); setNotice('Signed out.') }

  async function startAttempt() {
    setBusy(true); setNotice('')
    try {
      const { data, error } = await supabase.rpc('start_my_attempt')
      if (error) throw error
      setAttempt(data?.attempt || data)
      setQuestion(data?.question || null)
      setNotice('Timer started. Your progress is saved on the server.')
      await loadTeamState()
    } catch (e) { setNotice(errText(e)) } finally { setBusy(false) }
  }

  async function submitAnswer(e) {
    e.preventDefault(); setBusy(true); setNotice('')
    try {
      const { data, error } = await supabase.rpc('submit_my_answer', { p_answer: answer })
      if (error) throw error
      const result = Array.isArray(data) ? data[0] : data
      setNotice(result?.message || (result?.correct ? 'Correct! Next question unlocked.' : 'Not correct. Try again.'))
      setAnswer('')
      await loadTeamState()
    } catch (e2) { setNotice(errText(e2)) } finally { setBusy(false) }
  }

  async function loadAdmin() {
    const [t, a, q] = await Promise.all([
      supabase.from('teams').select('id,name,team_code,created_at').order('name'),
      supabase.from('admin_attempt_overview').select('*').order('started_at', { ascending: true }),
      supabase.from('questions').select('id,round_no,sequence_no,prompt,options,points,checkpoint_label,is_published').order('round_no').order('sequence_no')
    ])
    const err = t.error || a.error || q.error
    if (err) setNotice(err.message)
    setTeams(t.data || []); setAllAttempts(a.data || []); setQuestions(q.data || [])
  }

  useEffect(() => { if (isAdmin && tab === 'admin') loadAdmin() }, [isAdmin, tab])

  async function createTeam(e) {
    e.preventDefault(); setBusy(true)
    try {
      const { error } = await supabase.rpc('admin_create_team', { p_name: newTeam.name, p_code: newTeam.code })
      if (error) throw error
      setNewTeam({ name: '', code: '' }); setNotice('Team created. Create/login credentials separately and assign the team to the account in Supabase if using invite-only setup.')
      await loadAdmin()
    } catch (e2) { setNotice(errText(e2)) } finally { setBusy(false) }
  }

  async function saveQuestion(e) {
    e.preventDefault(); setBusy(true)
    try {
      const opts = newQuestion.options.split('\\n').map(s => s.trim()).filter(Boolean)
      const { error } = await supabase.rpc('admin_add_question', {
        p_round_no: Number(newQuestion.round_no), p_prompt: newQuestion.prompt,
        p_options: opts, p_answer: newQuestion.answer, p_points: Number(newQuestion.points),
        p_checkpoint_label: newQuestion.checkpoint_label || `Round ${newQuestion.round_no}`
      })
      if (error) throw error
      setNewQuestion({ round_no: 1, prompt: '', options: 'A) Option one\\nB) Option two\\nC) Option three\\nD) Option four', answer: '', points: 10, checkpoint_label: '' })
      setNotice('Question saved as unpublished. Review it, then publish it in Supabase before the event.')
      await loadAdmin()
    } catch (e2) { setNotice(errText(e2)) } finally { setBusy(false) }
  }

  async function qualifyTeam(teamId, roundNo, qualified) {
    const { error } = await supabase.rpc('admin_set_qualification', { p_team_id: teamId, p_round_no: roundNo, p_qualified: qualified })
    setNotice(error ? error.message : `Qualification updated for round ${roundNo}.`)
    await loadAdmin()
  }

  async function publishQuestion(id, published) {
    const { error } = await supabase.rpc('admin_publish_question', { p_question_id: id, p_published: published })
    setNotice(error ? error.message : 'Question publication updated.')
    await loadAdmin()
  }

  const qrItems = useMemo(() => questions.filter(q => q.is_published), [questions])
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const qrUrl = (q) => `${origin}/?checkpoint=${encodeURIComponent(q.id)}`
  const startUrl = `${origin}/?start=1`

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkpoint = params.get('checkpoint')
    const start = params.get('start')
    if (checkpoint) setQrBase(checkpoint)
    if (start) setQrBase('START')
  }, [])

  if (!configured) return <main className="center"><section className="panel setup"><div className="eyebrow">TECHSPARDHA 2K26</div><h1>Treasure Hunt</h1><p>Add your Supabase project URL and anon key to <code>.env</code> to connect the app.</p><p>See <code>README.md</code> for setup, database schema, admin setup, and deployment.</p></section></main>

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">T</div><div><div className="eyebrow">TECHSPARDHA 2K26</div><strong>Treasure Hunt</strong></div></div>
      {session && <div className="header-right"><span className="role-chip">{isAdmin ? 'ADMIN' : 'TEAM PORTAL'}</span><button className="button ghost small" onClick={signOut}>Sign out</button></div>}
    </header>
    <main className="main">
      {!session ? <section className="auth-layout"><div className="hero"><div className="eyebrow">FOUR ROUNDS. ONE WINNER.</div><h1>Crack the clues.<br/><span>Find the treasure.</span></h1><p>Team-based technical puzzles, QR checkpoints, and a live event timer.</p><div className="round-strip">{ROUND_NAMES.map((r,i)=><div className="round-pill" key={r}><span>{String(i+1).padStart(2,'0')}</span>{r.split('· ')[1]}</div>)}</div></div>
        <form className="panel auth-card" onSubmit={signIn}><div className="eyebrow">{authMode === 'signin' ? 'WELCOME BACK' : 'TEAM ACCOUNT REQUEST'}</div><h2>{authMode === 'signin' ? 'Sign in' : 'Request team access'}</h2>
          {authMode === 'signup' && <><label>Team name (request only)<input value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="e.g. Byte Bandits"/></label><label>Team code (provided by coordinator)<input value={teamCode} onChange={e=>setTeamCode(e.target.value)} placeholder="e.g. T01"/></label></>}
          <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="team@example.com"/></label>
          <label>Password<input type="password" required minLength="8" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters"/></label>
          <button className="button primary full" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in →' : 'Request access →'}</button>
          <button type="button" className="link-button" onClick={()=>setAuthMode(authMode==='signin'?'signup':'signin')}>{authMode==='signin'?'Need an account? Request access':'Already have an account? Sign in'}</button>
          <p className="muted tiny">Team access requires coordinator approval. Do not share passwords.</p>
        </form></section> :
      !profile ? <section className="panel center-panel"><h2>Loading your access…</h2><p className="muted">If this stays here, ask the coordinator to assign your role/team in Supabase.</p></section> :
      isAdmin ? <section className="admin-view">
        <div className="page-heading"><div><div className="eyebrow">CONTROL ROOM</div><h1>Coordinator dashboard</h1><p>Manage teams, questions, checkpoints and qualification.</p></div><div className="status-live"><span/> Connected</div></div>
        <div className="tabs"><button className={tab==='admin'?'active':''} onClick={()=>setTab('admin')}>Overview</button><button className={tab==='questions'?'active':''} onClick={()=>setTab('questions')}>Questions</button><button className={tab==='qrs'?'active':''} onClick={()=>setTab('qrs')}>QR codes</button></div>
        {tab==='admin' && <><div className="stat-grid"><div className="stat-card"><span>REGISTERED TEAMS</span><strong>{teams.length}</strong></div><div className="stat-card"><span>ATTEMPTS STARTED</span><strong>{allAttempts.length}</strong></div><div className="stat-card"><span>QUESTIONS</span><strong>{questions.length}</strong></div><div className="stat-card"><span>ROUNDS</span><strong>04</strong></div></div>
          <div className="two-col"><form className="panel" onSubmit={createTeam}><div className="eyebrow">REGISTRATION</div><h2>Create team</h2><label>Team name<input required value={newTeam.name} onChange={e=>setNewTeam({...newTeam,name:e.target.value})} placeholder="Circuit Breakers"/></label><label>Team code<input required value={newTeam.code} onChange={e=>setNewTeam({...newTeam,code:e.target.value.toUpperCase()})} placeholder="T01"/></label><button className="button primary" disabled={busy}>Create team</button><p className="muted tiny">Create team records here. User accounts and team assignment are managed separately for security.</p></form>
          <div className="panel"><div className="eyebrow">ELIMINATION</div><h2>Qualification targets</h2>{DEFAULT_QUALIFIERS.map((n,i)=><div className="qual-row" key={n}><span>Round {i+1}</span><strong>Top {n===1?'1 / Winner':n}</strong></div>)}<p className="muted tiny">Adjust targets if actual registration differs from the suggested 20-team format.</p></div></div>
          <div className="panel table-panel"><div className="section-head"><div><div className="eyebrow">LIVE MONITOR</div><h2>Team attempts</h2></div><button className="button ghost small" onClick={loadAdmin}>Refresh</button></div>
            <div className="table-wrap"><table><thead><tr><th>Team</th><th>Status</th><th>Round</th><th>Elapsed</th><th>Score</th><th>Qualify</th></tr></thead><tbody>{allAttempts.map(a=><tr key={a.team_id}><td><strong>{a.team_name}</strong><small>{a.team_code}</small></td><td><span className={`status ${a.status}`}>{a.status}</span></td><td>{a.current_round || '—'}</td><td>{a.elapsed_seconds == null?'—':fmtSeconds(a.elapsed_seconds)}</td><td>{a.total_score ?? 0}</td><td><select defaultValue="" onChange={e=>{if(e.target.value) qualifyTeam(a.team_id,Number(e.target.value),true)}}><option value="">Set round…</option>{[1,2,3,4].map(n=><option key={n} value={n}>Qualify R{n}</option>)}</select></td></tr>)}</tbody></table>{!allAttempts.length&&<p className="empty">No attempts yet. Teams appear after starting.</p>}</div></div>
        </>}
        {tab==='questions' && <><form className="panel question-form" onSubmit={saveQuestion}><div className="eyebrow">QUESTION BUILDER</div><h2>Add a medium-level question</h2><div className="form-grid"><label>Round<select value={newQuestion.round_no} onChange={e=>setNewQuestion({...newQuestion,round_no:Number(e.target.value)})}>{[1,2,3,4].map(n=><option key={n} value={n}>{ROUND_NAMES[n-1]}</option>)}</select></label><label>Points<input type="number" min="1" value={newQuestion.points} onChange={e=>setNewQuestion({...newQuestion,points:e.target.value})}/></label><label className="wide">Question<textarea required rows="3" value={newQuestion.prompt} onChange={e=>setNewQuestion({...newQuestion,prompt:e.target.value})} placeholder="Write the clue or technical question…"/></label><label className="wide">Options — one per line<textarea required rows="4" value={newQuestion.options} onChange={e=>setNewQuestion({...newQuestion,options:e.target.value})}/></label><label>Correct answer<input required value={newQuestion.answer} onChange={e=>setNewQuestion({...newQuestion,answer:e.target.value})} placeholder="Enter exact option/text"/></label><label>Checkpoint label<input value={newQuestion.checkpoint_label} onChange={e=>setNewQuestion({...newQuestion,checkpoint_label:e.target.value})} placeholder="Computer Lab"/></label></div><button className="button primary" disabled={busy}>Save question</button><p className="muted tiny">Correct answers are stored server-side and are not returned to team accounts.</p></form>
          <div className="panel table-panel"><h2>Question bank</h2><div className="table-wrap"><table><thead><tr><th>Round</th><th>Question</th><th>Checkpoint</th><th>Status</th><th>Action</th></tr></thead><tbody>{questions.map(q=><tr key={q.id}><td>R{q.round_no}</td><td>{q.prompt}</td><td>{q.checkpoint_label}</td><td>{q.is_published?'Published':'Draft'}</td><td><button className="button small ghost" onClick={()=>publishQuestion(q.id,!q.is_published)}>{q.is_published?'Unpublish':'Publish'}</button></td></tr>)}</tbody></table></div></div></>}
        {tab==='qrs' && <div className="panel"><div className="eyebrow">PRINT & PLACE</div><h2>QR code generator</h2><p className="muted">Print the start QR and one QR for each published question/checkpoint. Test scans on a phone before the event.</p><div className="qr-grid"><div className="qr-card"><QRCodeSVG value={startUrl} size={164}/><strong>START / LOGIN</strong><small>Scan to open team portal</small><button className="button ghost small" onClick={()=>window.open(startUrl,'_blank')}>Preview link</button></div>{qrItems.map(q=><div className="qr-card" key={q.id}><QRCodeSVG value={qrUrl(q)} size={164}/><strong>R{q.round_no} · {q.checkpoint_label}</strong><small>{q.prompt}</small><button className="button ghost small" onClick={()=>window.open(qrUrl(q),'_blank')}>Preview link</button></div>)}</div><p className="muted tiny">QRs open the same website with a checkpoint identifier. The server still checks whether the team is eligible to access it.</p></div>}
      </section> :
      <section className="team-view"><div className="page-heading"><div><div className="eyebrow">TEAM PORTAL</div><h1>Your hunt starts here.</h1><p>Stay together. Solve carefully. The clock keeps running.</p></div><div className="timer-card"><span>ELAPSED TIME</span><strong>{fmtSeconds(elapsed)}</strong><small>Server start time is authoritative</small></div></div>
        {!profile.team_id && <div className="notice warning">Your account is not linked to a team yet. Ask the coordinator to assign your Team ID before starting.</div>}
        {attempt?.status === 'completed' ? <div className="panel result-panel"><div className="result-icon">✓</div><h2>Hunt completed</h2><p>Your completion has been recorded. Please report to the coordinator desk.</p><strong>{fmtSeconds(elapsed)}</strong></div> :
        !attempt?.started_at ? <div className="panel start-panel"><div className="start-symbol">⌁</div><div className="eyebrow">READY, TEAM?</div><h2>Scan the start QR, then begin.</h2><p>Your timer starts when you press start or open an eligible start checkpoint. Keep this tab available; your progress is saved if you navigate away.</p><button className="button primary large" disabled={busy||!profile.team_id} onClick={startAttempt}>{busy?'Starting…':'Start hunt →'}</button></div> :
        <div className="question-layout"><div className="panel progress-panel"><div className="eyebrow">YOUR PROGRESS</div>{ROUND_NAMES.map((r,i)=><div className={`progress-row ${question?.round_no===i+1?'current':''}`} key={r}><span className="progress-num">{i+1}</span><div><strong>{r}</strong><small>{question?.round_no===i+1?'In progress':question?.round_no>i+1?'Available / completed':'Locked until qualified'}</small></div><span className="progress-mark">{question?.round_no>i+1?'✓':question?.round_no===i+1?'●':'—'}</span></div>)}</div>
          <div className="panel active-question"><div className="question-top"><span className="round-tag">ROUND {question?.round_no || attempt.current_round || 1}</span><span className="points-tag">{question?.points ?? 0} PTS</span></div>
            {question ? <><div className="eyebrow">{question.checkpoint_label || 'CHECKPOINT'}</div><h2>{question.prompt}</h2><form onSubmit={submitAnswer}><div className="options">{(question.options||[]).map((opt,i)=><label className="option" key={i}><input type="radio" name="answer" value={opt} checked={answer===opt} onChange={()=>setAnswer(opt)}/><span>{opt}</span></label>)}</div><button className="button primary full" disabled={busy||!answer}>{busy?'Checking…':'Submit answer →'}</button></form></> : <><h2>Waiting for your next question</h2><p className="muted">Your team may be awaiting qualification by the coordinator. Refresh in a moment.</p><button className="button ghost" onClick={loadTeamState}>Refresh progress</button></>}
            <div className="notice">Back or refresh will not reset the clock. Your active question is restored from saved progress.</div></div></div>}
      </section>}
      {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss">×</button></div>}
    </main>
    <footer><span>TECHSPARDHA 2K26</span><span>Play fair · Stay safe · Find the treasure</span></footer>
  </div>
}
