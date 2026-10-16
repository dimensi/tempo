'use client';
import { useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { installServerNavigation } from '@/lib/workspace-navigation';
export function ReadNavigation() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  useEffect(
    () =>
      installServerNavigation((href, options) =>
        options?.replace
          ? router.replace(href, { scroll: options.scroll })
          : router.push(href, { scroll: options?.scroll }),
      ),
    [router],
  );
  useEffect(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [path, params]);
  return null;
}
