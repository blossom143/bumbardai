import { progressSchema } from '@hallway/shared/responses';
import { Check, Flag, MapPinned, Sparkles } from 'lucide-react';
import { api, useResource, type Quest } from '../../shared/api';
import { Card, ErrorText, Loading } from '../../shared/ui';

const rewards = [
  { name: 'First quest', target: 1 },
  { name: 'Community Builder', target: 4 },
  { name: 'Conference Hero', target: 6 },
];

export function QuestProgressMap({ quests }: { quests: Quest[] }) {
  const progress = useResource('progress', () => api('/progress', progressSchema));
  const completed = quests.filter((quest) => quest.status === 'completed').reverse();
  const active = quests.find((quest) => quest.status === 'active');
  const total = progress.data?.completed ?? completed.length;
  const upcoming = rewards.filter(({ target }) => total < target);

  return (
    <Card className="card block quest-map" aria-labelledby="quest-map-title">
      <div className="quest-map-heading">
        <span className="tile lavender">
          <MapPinned size={20} />
        </span>
        <div>
          <p className="eyebrow">YOUR ADVENTURE</p>
          <h2 id="quest-map-title">Quest progress map</h2>
        </div>
        <span className="chip">{total} completed</span>
      </div>

      {progress.loading && <Loading />}
      <ErrorText error={progress.error} />

      <ol className="quest-map-trail" aria-label="Completed quests and upcoming milestones">
        {completed.map((quest, index) => (
          <li className="quest-map-stop is-complete" key={quest.id}>
            <span className="quest-map-marker" aria-hidden="true">
              <Check size={15} />
            </span>
            <span className="quest-map-copy">
              <span className="quest-map-status">
                Checkpoint {total - completed.length + index + 1} · complete
              </span>
              <strong>{quest.title}</strong>
            </span>
          </li>
        ))}

        {active && (
          <li className="quest-map-stop is-current" aria-current="step">
            <span className="quest-map-marker" aria-hidden="true">
              <Sparkles size={15} />
            </span>
            <span className="quest-map-copy">
              <span className="quest-map-status">CURRENT QUEST</span>
              <strong>{active.title}</strong>
            </span>
          </li>
        )}

        {upcoming.length ? (
          upcoming.map((reward, index) => (
            <li className="quest-map-stop is-next" key={reward.name}>
              <span className="quest-map-marker" aria-hidden="true">
                <Flag size={15} />
              </span>
              <span className="quest-map-copy">
                <span className="quest-map-status">
                  {index === 0 ? 'NEXT MILESTONE' : 'UPCOMING'} · {reward.target - total} TO GO
                </span>
                <strong>{reward.name}</strong>
              </span>
            </li>
          ))
        ) : (
          <li className="quest-map-stop is-complete">
            <span className="quest-map-marker" aria-hidden="true">
              <Check size={15} />
            </span>
            <span className="quest-map-copy">
              <span className="quest-map-status">ALL MILESTONES REACHED</span>
              <strong>Conference Hero</strong>
            </span>
          </li>
        )}
      </ol>

      {completed.length === 0 && !active && (
        <p className="muted quest-map-note">Start a quest to place your first marker on the map.</p>
      )}
      {progress.data?.badges.length ? (
        <div className="quest-map-badges" aria-label="Earned badges">
          {progress.data.badges.map((badge) => (
            <span className="chip" key={badge}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
