import {
  checklistItemSchema,
  peopleSchema,
  preparationResultSchema,
  todaySchema,
} from '@hallway/shared/responses';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CloudSun,
  Compass,
  ListChecks,
  MapPin,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  api,
  useAction,
  useResource,
  type User,
  type Item,
  type Event,
  type Catalog,
} from '../../shared/api';
import {
  Checkbox,
  Input,
  Card,
  Button,
  dayLabel,
  Empty,
  ErrorText,
  Heading,
  Loading,
  points,
  time,
} from '../../shared/ui';

export function EventRow({ event }: { event: Event }) {
  return (
    <div className="event-row">
      <div className={'event-dot ' + event.category}>
        <CalendarDays size={16} />
      </div>
      <div className="event-name">
        <strong>{event.title}</strong>
        <small>{event.location || event.category}</small>
      </div>
      <div className="event-time">
        {event.startsAt ? time(event.startsAt) : 'All day / TBD'}
        {event.completedAt && <Check size={15} aria-label="Completed" />}
      </div>
    </div>
  );
}
export function Checklist({ eventId, items }: { eventId: string; items: Item[] }) {
  const change = useAction<Item, { id: string; status?: string; label?: string }>(
    ({ id, ...value }) => api('/checklist/' + id, checklistItemSchema, 'PATCH', value),
    ['today', 'events'],
  );
  const suggestions = useAction<{ added: number; mode: string }, void>(
    () => api('/events/' + eventId + '/preparation', preparationResultSchema, 'POST', {}),
    ['today', 'events'],
  );
  const add = useAction<Item, string>(
    (label) => api('/events/' + eventId + '/checklist', checklistItemSchema, 'POST', { label }),
    ['today', 'events'],
  );
  return (
    <div>
      {items
        .filter((item) => item.status !== 'dismissed')
        .map((item) => (
          <div className="check-row" key={item.id}>
            <label className={item.status === 'done' ? 'done' : ''}>
              <Checkbox
                checked={item.status === 'done'}
                onCheckedChange={(checked) =>
                  change.run({ id: item.id, status: checked === true ? 'done' : 'open' })
                }
              />
              {item.label}
            </label>
            <details>
              <summary aria-label={'Edit or dismiss ' + item.label}>⋯</summary>
              <div className="check-menu">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    change.run({
                      id: item.id,
                      label: String(new FormData(event.currentTarget).get('label')),
                    });
                  }}
                >
                  <Input
                    name="label"
                    aria-label="Edit checklist item"
                    defaultValue={item.label}
                    maxLength={180}
                  />
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </form>
                <Button
                  variant="ghost"
                  onClick={() => change.run({ id: item.id, status: 'dismissed' })}
                >
                  Dismiss
                </Button>
              </div>
            </details>
          </div>
        ))}
      <details className="add-item">
        <summary>Add an item</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            add.run(String(new FormData(form).get('label')), { onSuccess: () => form.reset() });
          }}
        >
          <Input name="label" aria-label="New checklist item" required maxLength={180} />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </details>
      <Button variant="secondary" disabled={suggestions.loading} onClick={() => suggestions.run()}>
        <Sparkles size={15} /> Suggest prep items
      </Button>
      {suggestions.data && (
        <p className="muted" role="status">
          {suggestions.data.added} added ·{' '}
          {suggestions.data.mode === 'ai' ? 'AI suggestions' : 'Rules-based suggestions'}
        </p>
      )}
      <ErrorText error={change.error || add.error || suggestions.error} />
    </div>
  );
}
export function SessionDetails({ item }: { item: Catalog }) {
  return (
    <>
      <div className="chips">
        {item.demo && <span className="chip">Demo</span>}
        {item.skill && <span className="chip">{item.skill}</span>}
        {item.topics.slice(0, 3).map((topic) => (
          <span className="chip" key={topic}>
            {topic}
          </span>
        ))}
      </div>
      <p>
        {item.startsAt
          ? dayLabel(item.day!) + ' · ' + time(item.startsAt) + '–' + time(item.endsAt)
          : dayLabel(item.day!) + ' · Time TBD'}
      </p>
      {item.location && (
        <p className="with-icon">
          <MapPin size={15} />
          {item.location}
        </p>
      )}
      {item.speakers.length > 0 && <p className="muted">{item.speakers.join(', ')}</p>}
      <p className="session-description">{item.description}</p>
      <p className="reason">
        <Sparkles size={15} />
        {item.reason}
      </p>
      {!item.demo && (
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
          Official listing <ArrowRight size={13} />
        </a>
      )}
    </>
  );
}

export function Today({ user, ask }: { user: User; ask: () => void }) {
  const people = useResource('people', () => api('/people', peopleSchema), {
    ready: !!user.profile?.discoverable,
  });
  const match = people.data?.people[0];
  const query = useResource('today', () => api('/today', todaySchema));
  if (query.loading && !query.data) return <Loading />;
  if (!query.data)
    return (
      <>
        <ErrorText error={query.error} />
        <Button onClick={() => void query.refresh()}>Retry</Button>
      </>
    );
  const {
    briefing,
    forecast,
    events,
    next,
    current,
    checklist,
    quest,
    progress,
    recommendation,
    day,
    freeMinutes,
  } = query.data;
  return (
    <div className="today-page">
      <Heading
        label={dayLabel(day)}
        title={`Hello, ${user.profile?.nickname ?? 'explorer'}.`}
        description="Your conference day, one good move at a time."
        action={
          <div className="weather-mini">
            <CloudSun size={23} />
            <div>
              <strong>
                {forecast.high == null
                  ? 'Weather unavailable'
                  : `${forecast.high}° / ${forecast.low}° F`}
              </strong>
              <small>Salt Lake City{forecast.mode === 'demo' ? ' · Demo' : ''}</small>
            </div>
          </div>
        }
      />
      <div className="today-grid">
        <Card className="card block hero">
          <div className="hero-content">
            <div className="hero-tag">
              <Sparkles size={15} />{' '}
              {briefing.mode === 'ai' ? 'AI daily briefing' : 'Daily briefing · rules-based'}
            </div>
            <h2>{briefing.lead}</h2>
            <p>
              {events.length
                ? `You have ${events.length} ${events.length === 1 ? 'activity' : 'activities'} on your schedule today.`
                : 'Your schedule is open. Add a session or start with a small quest.'}
              {freeMinutes > 0 &&
                (next
                  ? ` You have ${freeMinutes} minutes before your next activity.`
                  : ' You have time to explore.')}
            </p>
            {forecast.guidance.length > 0 && (
              <p className="hero-weather">
                <CloudSun size={17} /> {forecast.guidance.join(' ')}
              </p>
            )}
            {briefing.tips.length > 0 && <p className="hero-tip">{briefing.tips.join(' ')}</p>}
            <Button className="hero-button" onClick={ask}>
              What should I do next? <ArrowRight size={17} />
            </Button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <Compass />
            <Star className="hero-star" />
            <Sparkles className="hero-sparkles" />
          </div>
        </Card>
        <Card className="card block quest-feature">
          <div className="section-label">
            <span className="tile peach">
              <Compass size={20} />
            </span>
            <span>HALLWAY QUEST</span>
          </div>
          <h2>{quest?.title ?? 'A little courage goes a long way.'}</h2>
          <p>
            {quest?.mission ??
              'Try a short challenge to meet someone, explore a new idea, or simply find your bearings.'}
          </p>
          <div className="quest-meta">
            <Zap size={16} />{' '}
            {quest
              ? '+' + points[quest.difficulty] + ' XP · ' + quest.minutes + ' min'
              : 'Start small · Earn XP'}
          </div>
          <Link className="text-link" to="/quests">
            {quest ? 'Open your quest' : 'Find a quest'} <ArrowRight size={17} />
          </Link>
        </Card>
        <Card className="card block dashboard-card">
          <div className="section-heading">
            <span className="tile lavender">
              <CalendarDays size={19} />
            </span>
            <h2>On your schedule</h2>
            <Link to="/schedule" aria-label="View schedule">
              <ChevronRight size={21} />
            </Link>
          </div>
          {(current || next) && (
            <div className="highlight">
              <div className="eyebrow">{current ? 'Happening now' : 'Up next'}</div>
              <EventRow event={(current ?? next)!} />
            </div>
          )}
          {events.length > 0 ? (
            events
              .filter((event) => event.id !== (current ?? next)?.id)
              .slice(0, 3)
              .map((event) => <EventRow key={event.id} event={event} />)
          ) : (
            <Empty title="No activities today">Add a session or make a plan of your own.</Empty>
          )}
          <Link className="text-link" to="/schedule">
            View full schedule <ArrowRight size={16} />
          </Link>
        </Card>
        <Card className="card block dashboard-card">
          <div className="section-heading">
            <span className="tile mint">
              <ListChecks size={20} />
            </span>
            <h2>Get ready</h2>
          </div>
          {checklist ? (
            <>
              <p className="muted">{checklist.title}</p>
              <Checklist eventId={checklist.eventId} items={checklist.items} />
            </>
          ) : (
            <Empty title="You’re caught up">
              Preparation items appear here when you add an activity.
            </Empty>
          )}
        </Card>
        <Card className="card block dashboard-card">
          <div className="section-heading">
            <span className="tile lavender">
              <Sparkles size={19} />
            </span>
            <h2>Worth exploring</h2>
          </div>
          {recommendation ? (
            <>
              <h3>{recommendation.title}</h3>
              <p className="muted">{recommendation.reason}</p>
              <p>
                {time(recommendation.startsAt)} · {recommendation.location}
              </p>
            </>
          ) : (
            <p className="muted">Browse the catalog to see what’s coming up.</p>
          )}
          <Link
            className="text-link"
            to={
              recommendation
                ? '/explore?session=' + encodeURIComponent(recommendation.id)
                : '/explore'
            }
          >
            Explore sessions <ArrowRight size={16} />
          </Link>
        </Card>
        <Card className="card block dashboard-card">
          <div className="section-heading">
            <span className="tile peach">
              <Zap size={19} />
            </span>
            <h2>Your progress</h2>
          </div>
          <strong className="xp-number">{progress.xp} XP</strong>
          <div className="progress-track">
            <div style={{ width: (progress.xp % 100) + '%' }} />
          </div>
          <p className="muted">
            Level {progress.level} · {100 - (progress.xp % 100)} XP to your next level
          </p>
          <Link className="text-link" to="/profile">
            See achievements <ArrowRight size={16} />
          </Link>
        </Card>
        <Card className="card block dashboard-card">
          <div className="section-heading">
            <span className="tile mint">
              <Star size={19} />
            </span>
            <h2>Who to meet</h2>
          </div>
          {match ? (
            <>
              <h3>{match.nickname}</h3>
              <p className="muted">{match.reason}</p>
            </>
          ) : (
            <p className="muted">
              Discover attendees who share your interests when you’re ready to meet someone.
            </p>
          )}
          <Link className="text-link" to="/explore?tab=people">
            Explore attendee matches <ArrowRight size={16} />
          </Link>
        </Card>
        {forecast.updatedAt && (
          <p className="muted weather-credit">
            {forecast.mode === 'demo'
              ? 'Simulated forecast for the guided demo'
              : (forecast.mode === 'stale' ? 'Cached forecast' : 'Forecast') +
                ' updated ' +
                time(forecast.updatedAt)}
            {forecast.mode !== 'demo' && (
              <>
                {' '}
                ·{' '}
                <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                  Open-Meteo
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
