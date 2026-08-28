import { useEffect, useRef, useState } from 'react';
import { cx } from './primitives';

/** A small shared reveal used by the public story pages. */
export function ScrollReveal({
  children,
  className,
  delay = 0,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cx('lore-reveal', visible && 'is-visible', className)}
      style={{ '--reveal-delay': `${delay * 90}ms` } as React.CSSProperties}
      {...rest}
    >
      {children}
    </div>
  );
}
