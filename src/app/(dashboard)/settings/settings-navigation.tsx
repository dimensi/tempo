'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ru } from '@/config/messages';
import classes from './settings.module.css';

const sections = [
  { id: 'connection', label: ru.yazioSettings },
  { id: 'sync', label: ru.settings.syncTitle },
  { id: 'trainers', label: ru.trainerSettings },
];

export function SettingsNavigation({ children }: { children: ReactNode }) {
  const [active, setActive] = useState('connection');

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
        setActive(current.at(-1)?.id ?? 'connection');
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
  }, []);

  return (
    <div className={classes.layout}>
      <nav className={classes.navigation} aria-label={ru.settings.navigation}>
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
