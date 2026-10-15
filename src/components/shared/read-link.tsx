'use client';
import type { ComponentProps } from 'react';
export interface ReadNavigationOptions {
  replace?: boolean;
  scroll?: boolean;
}
let navigate:
  ((href: string, options?: ReadNavigationOptions) => void) | undefined;
export function installReadNavigation(
  value: (href: string, options?: ReadNavigationOptions) => void,
) {
  navigate = value;
  return () => {
    if (navigate === value) navigate = undefined;
  };
}
export function requestReadNavigation(
  href: string,
  options: ReadNavigationOptions,
  fallback: () => void,
) {
  if (navigate) navigate(href, options);
  else fallback();
}
export function ReadLink({ onClick, ...props }: ComponentProps<'a'>) {
  return (
    <a
      {...props}
      data-tempo-read-link="true"
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
