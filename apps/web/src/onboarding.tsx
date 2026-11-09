import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { interests, profileInput, type ProfileInput } from '@hallway/shared';
import { ArrowRight, Compass, Github, Sparkles } from 'lucide-react';
import { api, useAction, type User } from './api';
import { Brand, Button, ErrorText } from './ui';

export function Auth({ onUser }: { onUser: (user: User) => void }) {
  const [register, setRegister] = useState(true);
  const [demo, setDemo] = useState(false);
  const auth = useAction<User, { email: string; password: string }>(values => api('/auth/' + (register ? 'register' : 'login'), 'POST', register ? { ...values, demo } : values));
  return <main className="auth-layout">
    <section className="auth-intro"><Brand/><div className="auth-art" aria-hidden="true"><Compass/><Sparkles/></div>
      <div className="eyebrow">Your conference field guide</div>
      <h1>Turn every conference into an adventure.</h1>
      <p>Find the talks worth your time, arrive prepared, and make a connection at your own pace.</p>
      <div className="auth-edition">KubeCon North America 2026 · Salt Lake City</div>
    </section>
    <section className="auth-form"><div className="eyebrow">The adventure starts here</div><h2>{register ? 'Create your account' : 'Welcome back'}</h2>
      <form className="form" onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        auth.mutate({ email: String(form.get('email')), password: String(form.get('password')) }, { onSuccess: onUser });
      }}>
        <label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></label>
        <label>Password<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={10} placeholder="At least 10 characters"/></label>
        {register && <label className="check-label"><input type="checkbox" checked={demo} onChange={event => setDemo(event.target.checked)}/> Use the guided demo with sample data</label>}
        <ErrorText error={auth.error}/><Button type="submit" disabled={auth.isPending}>{auth.isPending ? 'One moment…' : register ? 'Start my adventure' : 'Sign in'} <ArrowRight size={17}/></Button>
      </form>
      <Button variant="ghost" onClick={() => { setRegister(!register); auth.reset(); }}>{register ? 'Already have an account? Sign in' : 'New here? Create an account'}</Button>
    </section>
  </main>;
}

const defaults: ProfileInput = { nickname: '', background: '', interests: [], goals: '', firstTime: true, comfort: 'warming-up', difficulty: 'easy', discoverable: false, shareBackground: false };
export function ProfileForm({ user, onUser, onboarding = false }: { user: User; onUser: (user: User) => void; onboarding?: boolean }) {
  const form = useForm<ProfileInput>({ defaultValues: user.profile ?? defaults, resolver: zodResolver(profileInput) });
  const save = useAction<User, ProfileInput>(value => api('/profile', 'PUT', value), ['today', 'catalog', 'people']);
  const github = useAction<{ nickname: string; background: string }, string>(value => api('/github/' + encodeURIComponent(value)));
  const [login, setLogin] = useState('');
  const chosen = form.watch('interests');
  const discoverable = form.watch('discoverable');
  const fieldError = Object.values(form.formState.errors)[0]?.message;
  return <form className="form profile-form" onSubmit={form.handleSubmit(value => save.mutate(value, { onSuccess: onUser }))}>
    <div className="form-grid"><label>Nickname<input {...form.register('nickname')} placeholder="What should we call you?" /></label>
      <label>Professional background<input {...form.register('background')} placeholder="e.g. Platform engineer" /></label></div>
    <div className="github-line"><label>GitHub username <span className="muted">(optional)</span><input value={login} onChange={event => setLogin(event.target.value)} placeholder="octocat"/></label>
      <Button variant="secondary" onClick={() => github.mutate(login.trim())} disabled={!login.trim() || github.isPending}><Github size={17}/> Preview</Button></div>
    <ErrorText error={github.error}/>
    {github.data && <div className="inline-note"><div><strong>{github.data.nickname}</strong><p>{github.data.background}</p></div>
      <Button variant="secondary" onClick={() => { form.setValue('nickname', github.data.nickname); form.setValue('background', github.data.background); github.reset(); }}>Apply public profile</Button></div>}
    <fieldset><legend>What are you interested in?</legend><div className="chips">{interests.map(interest => <button type="button" key={interest}
      aria-pressed={chosen.includes(interest)} className={'chip ' + (chosen.includes(interest) ? 'selected' : '')}
      onClick={() => form.setValue('interests', chosen.includes(interest) ? chosen.filter(item => item !== interest) : [...chosen, interest], { shouldValidate: true })}>{interest}</button>)}</div></fieldset>
    <label>Conference goals<textarea rows={2} {...form.register('goals')} placeholder="What would make this conference a win for you?"/></label>
    <div className="form-grid"><label>Networking comfort<select {...form.register('comfort')}><option value="quiet">I prefer a quiet start</option><option value="warming-up">I’m warming up</option><option value="outgoing">I’m ready to meet people</option></select></label>
      <label>Quest difficulty<select {...form.register('difficulty')}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label></div>
    <label className="check-label"><input type="checkbox" {...form.register('firstTime')}/> This is my first time at this conference</label>
    <label className="check-label"><input type="checkbox" {...form.register('discoverable')}/> Let other attendees discover me</label>
    {discoverable && <label className="check-label"><input type="checkbox" {...form.register('shareBackground')}/> Show my professional background to attendees</label>}
    {fieldError && <p className="error" role="alert">{fieldError}</p>}<ErrorText error={save.error}/>
    <div><Button type="submit" disabled={save.isPending}>{onboarding ? 'Go to Today' : 'Save preferences'} <ArrowRight size={17}/></Button> {save.isSuccess && !onboarding && <span role="status" className="muted">Saved</span>}</div>
  </form>;
}
