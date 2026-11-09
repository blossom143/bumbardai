import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, KeyRound, LogOut, Trophy, Zap } from 'lucide-react';
import { api, useAction, type Preferences, type Progress, type User } from './api';
import { ProfileForm } from './onboarding';
import { Button, ErrorText, Heading, Loading } from './ui';

type Credential = { id: string; label: string; expiresAt: string; canWrite: boolean };
const prefs: Preferences = { enabled: false, quietStart: '22:00', quietEnd: '07:00', zone: 'America/Denver' };
function Reminders({ user }: { user: User }) {
  const [message, setMessage] = useState('');
  const save = useAction<Preferences, Preferences>(value => api('/reminders/preferences', 'PUT', value), ['reminders']);
  const push = useAction<void, void>(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Browser push is unavailable here. In-app reminders still work.');
    const { key } = await api<{ key: string | null }>('/push/key');
    if (!key) throw new Error('Browser push is not configured on this server. In-app reminders still work.');
    if (await Notification.requestPermission() !== 'granted') throw new Error('Browser notifications are disabled.');
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('/push/subscriptions', 'POST', subscription.toJSON());
    setMessage('Browser notifications enabled.');
  });
  const current = save.data ?? user.reminderPrefs ?? prefs;
  return <section className="card dashboard-card"><h2 className="with-icon"><Bell size={21}/> Reminders</h2>
    <form className="form" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      save.mutate({ enabled: data.has('enabled'), quietStart: String(data.get('quietStart')), quietEnd: String(data.get('quietEnd')), zone: String(data.get('zone')) });
    }}>
      <label className="check-label"><input name="enabled" type="checkbox" defaultChecked={current.enabled}/> Enable reminders</label>
      <div className="form-grid"><label>Quiet hours start<input name="quietStart" type="time" required defaultValue={current.quietStart}/></label>
        <label>Quiet hours end<input name="quietEnd" type="time" required defaultValue={current.quietEnd}/></label></div>
      <label>Reminder time zone<input name="zone" required defaultValue={current.zone}/></label>
      <ErrorText error={save.error || push.error}/>
      <div className="button-row"><Button type="submit" disabled={save.isPending}>Save reminders</Button>
        <Button variant="secondary" disabled={!current.enabled || push.isPending} onClick={() => push.mutate()}>Enable browser push</Button></div>
      {(message || save.isSuccess) && <p className="muted" role="status">{message || 'Reminder settings saved.'}</p>}
    </form>
  </section>;
}
function Credentials() {
  const query = useQuery({ queryKey: ['credentials'], queryFn: () => api<Credential[]>('/mcp/credentials') });
  const create = useAction<{ token: string }, { label: string; canWrite: boolean }>(input => api('/mcp/credentials', 'POST', input), ['credentials']);
  const revoke = useAction<void, string>(id => api('/mcp/credentials/' + id, 'DELETE'), ['credentials']);
  return <section className="card dashboard-card"><h2 className="with-icon"><KeyRound size={20}/> Connect an AI client</h2>
    <p>Use a credential with the local Hallway Quest MCP server. New credentials expire in 30 days.</p>
    <form className="form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); create.mutate({ label: String(data.get('label')), canWrite: data.has('canWrite') }); }}>
      <label>Client name<input name="label" required maxLength={80} placeholder="My AI assistant"/></label>
      <label className="check-label"><input name="canWrite" type="checkbox"/> Allow quest completion</label>
      <Button type="submit" disabled={create.isPending}>Create credential</Button>
    </form>
    {create.data && <div className="inline-note credential"><label>Copy this credential now<input readOnly value={create.data.token} onFocus={event => event.target.select()}/></label>
      <Button variant="secondary" onClick={() => create.reset()}>Hide credential</Button></div>}
    {query.data?.map(item => <div className="inline-note" key={item.id}><span>{item.label} · {item.canWrite ? 'Quest completion allowed' : 'Read only'}</span>
      <Button variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>Revoke</Button></div>)}
    <ErrorText error={query.error || create.error || revoke.error}/>
  </section>;
}
export function Profile({ user, onUser, logout }: { user: User; onUser: (user: User) => void; logout: () => void }) {
  const progress = useQuery({ queryKey: ['progress'], queryFn: () => api<Progress>('/progress') });
  return <>
    <Heading label="Your field notes" title="Profile" description="Make Hallway Quest work the way you do." action={<Button variant="secondary" onClick={logout}><LogOut size={17}/> Sign out</Button>}/>
    <section className="card dashboard-card"><h2 className="with-icon"><Trophy size={22}/> Achievements</h2>
      {progress.isPending && <Loading/>}<ErrorText error={progress.error}/>
      {progress.data && <><p className="with-icon"><Zap size={18}/> <strong>{progress.data.xp} XP</strong> · Level {progress.data.level} · {progress.data.completed} quests completed</p>
        <div className="chips">{progress.data.badges.length ? progress.data.badges.map(badge => <span className="chip badge" key={badge}><Trophy size={16}/> {badge}</span>) : <p className="muted">Complete a quest to earn your first badge.</p>}</div></>}
    </section>
    <div className="profile-layout"><section className="card dashboard-card"><h2>Attendee preferences</h2><ProfileForm user={user} onUser={onUser}/></section>
      <div className="profile-side"><Reminders user={user}/><Credentials/></div></div>
  </>;
}
