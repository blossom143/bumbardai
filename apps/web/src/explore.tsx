import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, Compass, Search, Users } from 'lucide-react';
import { interests } from '@hallway/shared';
import { useSearchParams } from 'react-router-dom';
import { api, useAction, type Catalog, type SaveResult, type User } from './api';
import { Button, dayLabel, Empty, ErrorText, Heading, Loading, Sheet, time } from './ui';
import { SessionDetails } from './today';

type Person = { id: string; nickname: string; background?: string; shared: string[]; reason: string; icebreaker: string };
type Intro = { id: string; personId: string; nickname: string; status: string; incoming: boolean };
function People({ user }: { user: User }) {
  const query = useQuery({ queryKey: ['people'], queryFn: () => api<{ people: Person[]; introductions: Intro[] }>('/people') });
  const intro = useAction<unknown, string>(id => api('/people/' + id + '/intro', 'POST', {}), ['people']);
  const reply = useAction<unknown, { id: string; accept: boolean }>(({ id, accept }) => api('/introductions/' + id, 'PATCH', { accept }), ['people']);
  return <>
    {!user.profile?.discoverable && <p className="inline-note">Enable attendee discovery in Profile to meet people and send introductions.</p>}
    {query.isPending && <Loading/>}<ErrorText error={query.error || intro.error || reply.error}/>
    {!!query.data?.introductions.length && <section className="card dashboard-card"><h2>Introductions</h2>
      {query.data.introductions.map(item => <div className="inline-note" key={item.id}><span>{item.nickname} · {item.status}</span>
        {item.incoming && item.status === 'pending' && <div className="button-row"><Button onClick={() => reply.mutate({ id: item.id, accept: true })}>Accept</Button>
          <Button variant="ghost" onClick={() => reply.mutate({ id: item.id, accept: false })}>Decline</Button></div>}</div>)}</section>}
    <div className="cards-grid">{query.data?.people.map(person => <article className="card dashboard-card" key={person.id}>
      <div className="section-label"><span className="tile mint"><Users size={18}/></span> ATTENDEE MATCH</div>
      <h2>{person.nickname}</h2>{person.background && <p>{person.background}</p>}
      <p className="muted">{person.reason}</p><div className="chips">{person.shared.map(tag => <span className="chip" key={tag}>{tag}</span>)}</div>
      <p className="reason">“{person.icebreaker}”</p>
      <Button variant="secondary" disabled={intro.isPending || query.data.introductions.some(item => item.personId === person.id)}
        onClick={() => intro.mutate(person.id)}>Request introduction</Button>
    </article>)}</div>
    {query.data?.people.length === 0 && <Empty title="No matches yet">Attendees can choose to appear here from their profile.</Empty>}
  </>;
}

export function Explore({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const people = params.get('tab') === 'people';
  const [input, setInput] = useState('');
  const [day, setDay] = useState('');
  const [topic, setTopic] = useState('');
  const [skill, setSkill] = useState('');
  const [limit, setLimit] = useState(12);
  const q = useDeferredValue(input);
  const id = params.get('session');
  const query = useQuery({ queryKey: ['catalog', q, day, topic, skill, limit], enabled: !people, queryFn: () => api<{ results: Catalog[]; mode: string }>(
    '/catalog?' + new URLSearchParams({ q, ...(day ? { day } : {}), ...(topic ? { topic } : {}), ...(skill ? { skill } : {}), limit: String(limit) })) });
  const itemQuery = useQuery({ queryKey: ['catalog-item', id], enabled: !!id && !people, queryFn: () => api<Catalog>('/catalog/' + encodeURIComponent(id!)) });
  const item = query.data?.results.find(value => value.id === id) ?? itemQuery.data;
  const save = useAction<SaveResult, { id: string; confirmConflict?: boolean }>(
    ({ id, confirmConflict }) => api('/catalog/' + encodeURIComponent(id) + '/save', 'POST', { confirmConflict }), ['events', 'today']);
  const select = (value?: string) => { save.reset(); setParams(value ? { session: value } : {}); };
  return <>
    <Heading label="Find your people and your talks" title="Explore" description="Follow your curiosity through the conference."/>
    <div className="tabs" aria-label="Explore categories"><Button variant={!people ? 'secondary' : 'ghost'} onClick={() => setParams({})} aria-pressed={!people}><Compass size={17}/> Sessions</Button>
      <Button variant={people ? 'secondary' : 'ghost'} onClick={() => setParams({ tab: 'people' })} aria-pressed={people}><Users size={17}/> People</Button></div>
    {people ? <People user={user}/> : <>
      <section className="card search-panel"><label>Find a session<div className="search-field"><Search size={20}/><input value={input}
        onChange={event => { setInput(event.target.value); setLimit(12); }} placeholder="Try “beginner-friendly Kubernetes talks”"/></div></label>
        <div className="form-grid filters">
          <label>Date<input type="date" value={day} onChange={event => { setDay(event.target.value); setLimit(12); }}/></label>
          <label>Topic<select value={topic} onChange={event => { setTopic(event.target.value); setLimit(12); }}><option value="">All topics</option>{interests.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Skill level<select value={skill} onChange={event => { setSkill(event.target.value); setLimit(12); }}><option value="">All levels</option><option>Beginner</option><option>Advanced</option><option>Any Level</option></select></label>
        </div>
      </section>
      {query.isPending && <Loading/>}<ErrorText error={query.error}/>
      {query.data && <div className="results-line"><span>{query.data.results.length} shown</span><span>{query.data.mode === 'hybrid' ? 'Hybrid semantic search' : query.data.mode === 'keyword' ? 'Keyword-only search' : 'Conference catalog'}{user.demo ? ' · Demo' : ''}</span></div>}
      {query.data?.results.length === 0 && <Empty title="No sessions found">Try a broader search or remove a filter.</Empty>}
      <div className="cards-grid">{query.data?.results.map(result => <article key={result.id} className="card dashboard-card">
        <div className="eyebrow">{result.demo ? 'Demo · ' : ''}{result.category}</div><h2>{result.title}</h2>
        <p className="muted">{dayLabel(result.day!)} · {time(result.startsAt)}</p><p>{result.reason}</p>
        <Button variant="secondary" onClick={() => select(result.id)}>View details <ArrowRight size={16}/></Button>
      </article>)}</div>
      {query.data?.results.length === limit && limit < 50 && <Button className="section-gap" variant="secondary" onClick={() => setLimit(Math.min(50, limit + 12))}>Show more</Button>}
      <Sheet open={!!id} onOpenChange={open => { if (!open) select(); }} title={item?.title ?? 'Session details'}>
        {item ? <><SessionDetails item={item}/><div className="sheet-extra">
          <ErrorText error={save.error}/>
          {save.data?.conflicts?.length ? <div className="inline-note"><span>Overlaps with {save.data.conflicts.map(conflict => conflict.title).join(', ')}.</span>
            <Button onClick={() => save.mutate({ id: item.id, confirmConflict: true })}>Save anyway</Button></div>
            : save.data?.event ? <p role="status">Saved to your schedule</p>
            : <Button disabled={save.isPending} onClick={() => save.mutate({ id: item.id })}><CalendarPlus size={17}/> Save to schedule</Button>}
        </div></> : itemQuery.isPending ? <Loading/> : <ErrorText error={itemQuery.error}/>}
      </Sheet>
    </>}
  </>;
}
