import {
  IconHome,
  IconToolsKitchen2,
  IconBarbell,
  IconRuler,
  IconActivityHeartbeat,
  IconChartLine,
  IconFileText,
  IconSettings,
  IconDots,
  IconListDetails,
  IconMoonStars,
} from '@tabler/icons-react';
import { ru } from '@/config/messages';
const icons = {
  '/overview': IconHome,
  '/diary': IconToolsKitchen2,
  '/workouts': IconBarbell,
  '/measurements': IconRuler,
  '/anamnesis': IconActivityHeartbeat,
  '/recovery': IconMoonStars,
  '/analytics': IconChartLine,
  '/reports': IconFileText,
  '/settings': IconSettings,
};
function section(href: keyof typeof icons) {
  return {
    ...ru.sections.find((item) => item.href === href)!,
    href,
    icon: icons[href],
  };
}
export const sections = (Object.keys(icons) as (keyof typeof icons)[]).map(
  section,
);
export const mobileSections = [
  section('/overview'),
  { ...section('/diary'), title: ru.mobileNavigation.food },
  section('/workouts'),
  { href: '/more', title: ru.mobileNavigation.more, icon: IconDots },
];
export const exerciseCatalogSection = {
  href: '/workouts/catalog',
  title: ru.exerciseCatalog,
  icon: IconListDetails,
};
export const moreSections = [
  exerciseCatalogSection,
  ...[
    '/measurements',
    '/recovery',
    '/analytics',
    '/anamnesis',
    '/reports',
    '/settings',
  ].map((href) => sections.find((section) => section.href === href)!),
];
export function visibleNavigation<T extends { href: string }>(
  items: T[],
  role: string,
) {
  return role === 'OWNER'
    ? items
    : items.filter(({ href }) => href !== '/recovery');
}
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === '/more')
    return (
      pathname === '/more' ||
      moreSections.some((section) => isSectionActive(pathname, section.href))
    );
  if (href === '/workouts' && pathname.startsWith('/workouts/catalog'))
    return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
