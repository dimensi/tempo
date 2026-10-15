'use client';

import { useEffect, useState, type ReactNode } from 'react';
import classes from './section-navigation.module.css';

export function SectionNavigation({
  children,
  sections,
  label,
}: {
  children: ReactNode;
  sections: ReadonlyArray<{ id: string; label: string }>;
  label: string;
}) {
  const [active, setActive] = useState(sections[0]!.id);

  useEffect(() => {
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const atBottom =
          window.scrollY > 0 &&
          Math.ceil(window.scrollY + window.innerHeight) >=
            document.documentElement.scrollHeight - 2;
        const current = sections.filter((section) => {
          const element = document.getElementById(section.id);
          return (
            element &&
            element.getBoundingClientRect().top <=
              (atBottom ? window.innerHeight : 170)
          );
        });
        setActive(current.at(-1)?.id ?? sections[0]!.id);
      });
    }
    function followHash() {
      const id = window.location.hash.slice(1);
      if (!sections.some((section) => section.id === id)) return;
      const element = document.getElementById(id);
      element?.scrollIntoView();
      element?.focus({ preventScroll: true });
      setActive(id);
    }
    // Hydration must not override focus the user already placed in SSR content.
    const focused = document.activeElement;
    if (
      !focused ||
      focused === document.body ||
      focused === document.documentElement
    ) {
      followHash();
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    window.addEventListener('hashchange', followHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('hashchange', followHash);
    };
  }, [sections]);

  return (
    <div className={classes.layout}>
      <nav className={classes.navigation} aria-label={label}>
        {sections.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active === id ? 'location' : undefined}
            onClick={() => {
              document.getElementById(id)?.focus({ preventScroll: true });
              setActive(id);
            }}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className={classes.content}>{children}</div>
    </div>
  );
}
