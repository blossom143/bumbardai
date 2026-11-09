import type { ButtonHTMLAttributes, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
import { Compass, LoaderCircle, X } from 'lucide-react';
import { conferenceZone } from '@hallway/shared';

const buttonVariants = cva('button', { variants: { variant: { primary: 'button-primary', secondary: 'button-secondary', ghost: 'button-ghost' } }, defaultVariants: { variant: 'primary' } });
export function Button({ variant, className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button type={type} className={buttonVariants({ variant, className })} {...props} />;
}
export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="overlay" />
    <Dialog.Content className="sheet" aria-describedby={undefined}>
      <header className="sheet-header"><Dialog.Title>{title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" className="icon-button" aria-label="Close dialog"><X size={21}/></Button></Dialog.Close></header>
      <div className="sheet-body">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
export function Brand() { return <div className="brand"><span className="brand-mark"><Compass size={23}/></span><span>Hallway<span>Quest</span></span></div>; }
export function ErrorText({ error }: { error: unknown }) {
  return error ? <p className="error" role="alert">{error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.'}</p> : null;
}
export function Loading() { return <div className="loading" role="status"><LoaderCircle size={20} className="spin"/> Loading…</div>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><Compass size={23}/><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function Heading({ label, title, description, action }: { label?: string; title: string; description: string; action?: ReactNode }) {
  return <header className="heading"><div>{label && <div className="eyebrow">{label}</div>}<h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
export function time(iso: string | null | undefined, zone = conferenceZone) {
  if (!iso) return 'Time TBD';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(new Date(iso));
}
export function dayLabel(day: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric', ...options }).format(new Date(day + 'T12:00:00Z'));
}
export const points = { easy: 50, medium: 75, hard: 100 };
