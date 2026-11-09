import { EventRow } from '../today/today';
import { Brand, Card, Empty, Heading } from '../../shared/ui';
import { readSnapshot } from './snapshot';

export function OfflinePage() {
  const snapshot = readSnapshot();
  return (
    <main className="offline-page">
      <Brand />
      <Heading
        label="Offline · Read only"
        title={snapshot ? 'Hi, ' + snapshot.nickname + '.' : 'You’re offline.'}
        description="Reconnect to update your plans or use the assistant."
      />
      <Card className="card block dashboard-card">
        <h2>Saved schedule</h2>
        {snapshot?.events?.length ? (
          snapshot.events.map((event) => <EventRow key={event.id} event={event} />)
        ) : (
          <Empty title="No cached activities" />
        )}
      </Card>
      <Card className="card block dashboard-card">
        <h2>Saved quests</h2>
        {snapshot?.quests?.length ? (
          snapshot.quests.map((quest) => (
            <article key={quest.id}>
              <h3>{quest.title}</h3>
              <p>{quest.mission}</p>
            </article>
          ))
        ) : (
          <Empty title="No cached quests" />
        )}
      </Card>
    </main>
  );
}
