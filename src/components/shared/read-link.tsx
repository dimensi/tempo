'use client';
import type { ComponentProps } from 'react';
let navigate: ((href: string) => void) | undefined;
export function installReadNavigation(value: (href: string) => void) {
  navigate = value;
  return () => {
    if (navigate === value) navigate = undefined;
  };
}
export function ReadLink({ onClick, ...props }: ComponentProps<'a'>) {
  return (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target ||
          props.download ||
          !props.href ||
          !navigate
        )
          return;
        const url = new URL(props.href, location.href);
        if (url.origin !== location.origin) return;
        event.preventDefault();
        navigate(props.href);
      }}
    />
  );
}
