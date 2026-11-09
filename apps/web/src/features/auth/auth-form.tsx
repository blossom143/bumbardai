import { attendeeSchema } from '@hallway/shared/responses';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { credentials } from '@hallway/shared';
import { ArrowRight, Compass, Sparkles } from 'lucide-react';
import { api, useAction, type User } from '../../shared/api';
import { Brand, Button, Checkbox, ErrorText, Input } from '../../shared/ui';

export function AuthForm({ onUser }: { onUser: (user: User) => void }) {
  const [register, setRegister] = useState(true);
  const [demo, setDemo] = useState(false);
  const form = useForm({
    resolver: zodResolver(credentials),
    defaultValues: { email: '', password: '' },
  });
  const auth = useAction((values: { email: string; password: string }) => {
    const path = register ? '/auth/register' : '/auth/login';
    const payload = register ? { ...values, demo } : values;
    return api(path, attendeeSchema, 'POST', payload);
  });

  const submit = form.handleSubmit((values) => auth.run(values, { onSuccess: onUser }));
  const error =
    form.formState.errors.email?.message || form.formState.errors.password?.message || auth.error;
  const submitLabel = register ? 'Start my adventure' : 'Sign in';

  function switchMode() {
    setRegister(!register);
    auth.reset();
  }

  return (
    <main className="auth-layout">
      <section className="auth-intro">
        <Brand />
        <div className="auth-art" aria-hidden="true">
          <Compass />
          <Sparkles />
        </div>
        <div className="eyebrow">Your conference field guide</div>
        <h1>Turn every conference into an adventure.</h1>
        <p>
          Find the talks worth your time, arrive prepared, and make a connection at your own pace.
        </p>
        <div className="auth-edition">KubeCon North America 2026 · Salt Lake City</div>
      </section>
      <section className="auth-form">
        <div className="eyebrow">The adventure starts here</div>
        <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
        <form className="form" onSubmit={submit}>
          <label>
            Email
            <Input
              {...form.register('email')}
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <Input
              {...form.register('password')}
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              required
              minLength={10}
              placeholder="At least 10 characters"
            />
          </label>
          {register && (
            <label className="check-label">
              <Checkbox checked={demo} onCheckedChange={(checked) => setDemo(checked === true)} />{' '}
              Use the guided demo with sample data
            </label>
          )}
          <ErrorText error={error} />
          <Button type="submit" disabled={auth.loading}>
            {auth.loading ? 'One moment…' : submitLabel} <ArrowRight size={17} />
          </Button>
        </form>
        <Button variant="ghost" onClick={switchMode}>
          {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </Button>
      </section>
    </main>
  );
}
