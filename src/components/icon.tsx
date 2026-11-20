import { memo, useLayoutEffect, useRef } from 'react';
import { setIcon } from 'obsidian';

/** An Obsidian (Lucide) icon, drawn with `setIcon` so it matches the app. */
export const Icon = memo(function Icon({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} className={className ? `rr-icon ${className}` : 'rr-icon'} aria-hidden="true" />;
});
