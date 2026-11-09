import type { ReactNode } from 'react';
import { Button } from './components/ui/button';
import { Alert, AlertDescription } from './components/ui/alert';
import {
  Sheet as SheetRoot,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from './components/ui/sheet';
import { Compass, LoaderCircle, X } from 'lucide-react';
import { conferenceZone } from '@hallway/shared';

export { Button } from './components/ui/button';
export { Checkbox } from './components/ui/checkbox';
export { Card } from './components/ui/card';
export { Input } from './components/ui/input';
export { Textarea } from './components/ui/textarea';
export { NativeSelect } from './components/ui/native-select';

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="sheet gap-0"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <SheetHeader className="sheet-header flex-row">
          <SheetTitle>{title}</SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" className="icon-button" aria-label="Close dialog">
              <X size={21} />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="sheet-body">{children}</div>
      </SheetContent>
    </SheetRoot>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Compass size={23} />
      </span>
      <span>
        Hallway<span>Quest</span>
      </span>
    </div>
  );
}
export function ErrorText({ error }: { error: unknown }) {
  return error ? (
    <Alert variant="destructive" className="error">
      <AlertDescription>
        {error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Something went wrong.'}
      </AlertDescription>
    </Alert>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={20} className="spin" /> Loading…
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Compass size={23} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Heading({
  label,
  title,
  description,
  action,
}: {
  label?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="heading">
      <div>
        {label && <div className="eyebrow">{label}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
export function time(iso: string | null | undefined, zone = conferenceZone) {
  if (!iso) return 'Time TBD';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  }).format(new Date(iso));
}
export function dayLabel(day: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(new Date(day + 'T12:00:00Z'));
}
export const points = { easy: 50, medium: 75, hard: 100 };
