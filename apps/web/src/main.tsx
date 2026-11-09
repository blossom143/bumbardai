import React, { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { ArrowRight, Bell, CalendarDays, Compass, Home, Menu, Moon, Sparkles, Sun, Trophy, UserRound, WifiOff } from 'lucide-react';
import { api, ApiError, clearSnapshot, readSnapshot, saveSnapshot, useAction, useUI, type Advice, type Event, type Quest, type User } from './api';
import { Auth, ProfileForm } from './onboarding';
import { EventRow, Today } from './today';
import { Brand, Button, Empty, ErrorText, Heading, Loading, Sheet } from './ui';
import './styles.css';

const Explore = lazy(() => import('./explore').then(module => ({ default: module.Explore })));
const Schedule = lazy(() => import('./schedule').then(module => ({ default: module.Schedule })));
const Quests = lazy(() => import('./quests').then(module => ({ default: module.Quests })));
const Profile = lazy(() => import('./profile').then(module => ({ default: module.Profile })));

const client = new QueryClient({ defaultOptions: { queries: {
  retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1, staleTime: 15000,
} } });
const nav = [
  { path: '/', name: 'Today', icon: Home }, { path: '/explore', name: 'Explore', icon: Compass },
  { path: '/quests', name: 'Quests', icon: Trophy }, { path: '/schedule', name: 'Schedule', icon: CalendarDays },
  { path: '/profile', name: 'Profile', icon: UserRound },
];
const defaultQuestion = 'What should I do next?';
type Reminder = { id: string; message: string };

function Assistant({ open, close, initial }: { open: boolean; close: () => void; initial: string }) {
  const [question, setQuestion] = useState(initial);
  const action = useAction<Advice, string>(question => api('/assistant', 'POST', { question }), ['quests', 'today']);
  const asked = useRef(false);
  useEffect(() => {
    if (initial && !asked.current) { asked.current = true; action.mutate(initial); }
  }, [initial, action.mutate]);
  return <Sheet open={open} onOpenChange={value => { if (!value) close(); }} title="Your AI field guide">
    <p className="muted">Ask for a next step based on your schedule, interests, and available time.</p>
    {action.isPending && <Loading/>}<ErrorText error={action.error}/>
    {action.data && <div className="advice"><div className="eyebrow"><Sparkles size={15}/> {action.data.mode === 'ai' ? 'AI guidance' : 'Rules-based guidance'}</div>
      {action.data.lead && <p>{action.data.lead}</p>}<h3>{action.data.action.title}</h3><p>{action.data.action.detail}</p>
      {action.data.tips.map(tip => <p className="muted" key={tip}>{tip}</p>)}
      <Link to={action.data.action.path} onClick={close} className="text-link">Open {action.data.action.kind === 'break' ? 'Explore' : action.data.action.kind} <ArrowRight size={16}/></Link>
    </div>}
    <form className="form" onSubmit={event => { event.preventDefault(); action.mutate(question.trim()); }}>
      <label>Your question<textarea rows={2} maxLength={700} required value={question} onChange={event => setQuestion(event.target.value)} placeholder="I have 20 minutes before my next session…"/></label>
      <Button type="submit" disabled={!question.trim() || action.isPending}>Ask assistant <ArrowRight size={17}/></Button>
    </form>
  </Sheet>;
}

function Offline() {
  const snapshot = readSnapshot();
  return <main className="offline-page"><Brand/><Heading label="Offline · Read only" title={snapshot ? 'Hi, ' + snapshot.nickname + '.' : 'You’re offline.'} description="Reconnect to update your plans or use the assistant."/>
    <section className="card dashboard-card"><h2>Saved schedule</h2>{snapshot?.events?.length ? snapshot.events.map(event => <EventRow key={event.id} event={event}/>) : <Empty title="No cached activities"/>}</section>
    <section className="card dashboard-card"><h2>Saved quests</h2>{snapshot?.quests?.length ? snapshot.quests.map(quest => <article key={quest.id}><h3>{quest.title}</h3><p>{quest.mission}</p></article>) : <Empty title="No cached quests"/>}</section>
  </main>;
}

function Shell({ user, onUser }: { user: User; onUser: (user: User | null) => void }) {
  const navigate = useNavigate();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [assistant, setAssistant] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);
  const reminders = useQuery({ queryKey: ['reminders'], queryFn: () => api<Reminder[]>('/reminders'), refetchInterval: 30000 });
  const dismiss = useAction<void, string>(id => api('/reminders/' + id, 'DELETE'), ['reminders']);
  const logout = useAction<void, void>(async () => {
    await api('/auth/logout', 'POST');
    if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration()
      .then(registration => registration?.pushManager?.getSubscription())
      .then(subscription => subscription?.unsubscribe()).catch(() => {});
  });
  const saved = useQuery({ queryKey: ['events'], queryFn: () => api<Event[]>('/events') });
  const quests = useQuery({ queryKey: ['quests'], queryFn: () => api<Quest[]>('/quests') });
  useEffect(() => {
    if (queryClient.getQueryData<User>(['me'])?.id !== user.id) return;
    saveSnapshot(user, { ...(saved.data ? { events: saved.data } : {}),
      ...(quests.data ? { quests: quests.data.filter(quest => ['active', 'suggested'].includes(quest.status)) } : {}) });
  }, [queryClient, user, saved.data, quests.data]);
  const links = nav.map(({ path, name, icon: Icon }) => <NavLink key={path} to={path} end={path === '/'} title={name}>
    <Icon size={20}/><span>{name}</span></NavLink>);
  return <div className={'layout ' + (ui.collapsed ? 'collapsed' : '')}>
    <a className="skip" href="#main-content">Skip to content</a>
    <aside className="sidebar"><Link to="/" aria-label="Hallway Quest home"><Brand/></Link>
      <div className="workspace-label">CONFERENCE HUB</div><nav aria-label="Primary">{links}</nav>
      <div className="sidebar-footer"><div className="event-marker"><span className="tile lavender"><Compass size={17}/></span><span><strong>KubeCon NA ’26</strong><small>Salt Lake City, UT</small></span></div>
        <Button variant="ghost" onClick={ui.toggleSidebar} aria-label="Toggle sidebar"><Menu size={18}/><span>{ui.collapsed ? 'Expand' : 'Collapse sidebar'}</span></Button>
      </div>
    </aside>
    <div className="content-area">
      <header className="topbar"><div className="mobile-brand"><Brand/></div><div className="edition"><span/> KubeCon North America 2026</div>
        <div className="top-actions">{user.demo && <span className="demo-label">Demo replay</span>}
          <Button className="icon-button" variant="ghost" aria-label={ui.dark ? 'Use light mode' : 'Use dark mode'} onClick={ui.toggleDark}>{ui.dark ? <Sun size={19}/> : <Moon size={19}/>}</Button>
          <Button className="icon-button notice-button" variant="ghost" aria-label="Reminders" onClick={() => setNotifications(true)}><Bell size={20}/>{!!reminders.data?.length && <i/>}</Button>
          <Link className="avatar" to="/profile" aria-label="Your profile">{user.profile?.nickname.slice(0, 1).toUpperCase() || 'H'}</Link>
        </div>
      </header>
      <main id="main-content" className="page">
        <ErrorText error={logout.error}/>
        <Suspense fallback={<Loading/>}><Routes>
          <Route path="/" element={<Today user={user} ask={() => setAssistant(defaultQuestion)}/>}/>
          <Route path="/explore" element={<Explore user={user}/>}/>
          <Route path="/quests" element={<Quests/>}/>
          <Route path="/schedule" element={<Schedule user={user}/>}/>
          <Route path="/profile" element={<Profile user={user} onUser={onUser} logout={() => logout.mutate(undefined, { onSuccess: () => {
            onUser(null); navigate('/');
          } })}/>}/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes></Suspense>
        <footer>Hallway Quest <span>·</span> Make the hallway yours.</footer>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Primary mobile">{links}</nav>
    <Button className="assistant-fab" onClick={() => setAssistant('')} aria-label="Open AI assistant"><Sparkles size={21}/><span>Ask AI</span></Button>
    {assistant !== null && <Assistant open initial={assistant} close={() => setAssistant(null)}/>}
    <Sheet open={notifications} onOpenChange={setNotifications} title="Reminders">
      {reminders.isPending && <Loading/>}<ErrorText error={reminders.error || dismiss.error}/>
      {reminders.data?.length === 0 && <Empty title="You’re all caught up">Enable reminders in Profile to get timely preparation nudges.</Empty>}
      {reminders.data?.map(item => <div className="inline-note" key={item.id}><span>{item.message}</span><Button variant="ghost" onClick={() => dismiss.mutate(item.id)}>Dismiss</Button></div>)}
    </Sheet>
  </div>;
}

function App() {
  const queryClient = useQueryClient();
  const dark = useUI(state => state.dark);
  const [online, setOnline] = useState(navigator.onLine);
  const me = useQuery({ queryKey: ['me'], queryFn: async () => {
    try {
      const user = await api<User>('/me');
      const previous = queryClient.getQueryData<User | null>(['me']);
      if (previous && previous.id !== user.id) {
        clearSnapshot();
        queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'me' });
      }
      return user;
    }
    catch (error) { if (error instanceof ApiError && error.status === 401) { clearSnapshot(); return null; } throw error; }
  }, enabled: online });
  const setUser = (user: User | null) => {
    const current = queryClient.getQueryData<User | null>(['me']);
    queryClient.setQueryData(['me'], user);
    if (current?.id !== user?.id) {
      clearSnapshot();
      queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'me' });
    }
    if (user) saveSnapshot(user);
  };
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync); window.addEventListener('offline', sync);
    const storage = (event: StorageEvent) => { if (event.key === 'hallway-offline' && !event.newValue) void queryClient.invalidateQueries({ queryKey: ['me'] }); };
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); window.removeEventListener('storage', storage); };
  }, [queryClient]);
  useLayoutEffect(() => { if (me.data === null) clearSnapshot(); }, [me.data]);
  if (!online) return <><div className="offline-strip"><WifiOff size={16}/> Offline mode</div><Offline/></>;
  if (me.isPending) return <Loading/>;
  if (me.isError) return <main className="offline-page"><Brand/><ErrorText error={me.error}/><Button onClick={() => void me.refetch()}>Try again</Button>{readSnapshot() && <Offline/>}</main>;
  if (!me.data) return <Auth onUser={setUser}/>;
  if (!me.data.profile) return <main className="onboarding"><Brand/><Heading label="Your first checkpoint" title="Make this conference yours." description="Tell us a little about yourself. You can change any of this later."/>
    <section className="card dashboard-card"><ProfileForm user={me.data} onUser={setUser} onboarding/></section></main>;
  return <Shell key={me.data.id} user={me.data} onUser={setUser}/>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionConfig reducedMotion="user"><QueryClientProvider client={client}>
  <BrowserRouter><App/></BrowserRouter></QueryClientProvider></MotionConfig></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
