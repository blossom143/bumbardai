import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { adviceSchema } from '@hallway/shared/responses';
import { api, useAction, type Advice } from '../../shared/api';
import { Button, ErrorText, Loading, Sheet, Textarea } from '../../shared/ui';

export function AssistantSheet({
  open,
  close,
  initial,
}: {
  open: boolean;
  close: () => void;
  initial: string;
}) {
  const [question, setQuestion] = useState(initial);
  const action = useAction<Advice, string>(
    (question) => api('/assistant', adviceSchema, 'POST', { question }),
    ['quests', 'today'],
  );
  const asked = useRef(false);
  useEffect(() => {
    if (initial && !asked.current) {
      asked.current = true;
      action.run(initial);
    }
  }, [initial, action.run]);
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      title="Your AI field guide"
    >
      <p className="muted">
        Ask for a next step based on your schedule, interests, and available time.
      </p>
      {action.loading && <Loading />}
      <ErrorText error={action.error} />
      {action.data && (
        <div className="advice">
          <div className="eyebrow">
            <Sparkles size={15} />{' '}
            {action.data.mode === 'ai' ? 'AI guidance' : 'Rules-based guidance'}
          </div>
          {action.data.lead && <p>{action.data.lead}</p>}
          <h3>{action.data.action.title}</h3>
          <p>{action.data.action.detail}</p>
          {action.data.tips.map((tip) => (
            <p className="muted" key={tip}>
              {tip}
            </p>
          ))}
          <Link to={action.data.action.path} onClick={close} className="text-link">
            Open {action.data.action.kind === 'break' ? 'Explore' : action.data.action.kind}{' '}
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          action.run(question.trim());
        }}
      >
        <label>
          Your question
          <Textarea
            rows={2}
            maxLength={700}
            required
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="I have 20 minutes before my next session…"
          />
        </label>
        <Button type="submit" disabled={!question.trim() || action.loading}>
          Ask assistant <ArrowRight size={17} />
        </Button>
      </form>
    </Sheet>
  );
}
