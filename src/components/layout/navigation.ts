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
} from '@tabler/icons-react';
import { ru } from '@/config/messages';
const icons = {
  '/': IconHome,
  '/diary': IconToolsKitchen2,
  '/workouts': IconBarbell,
  '/measurements': IconRuler,
  '/anamnesis': IconActivityHeartbeat,
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
  section('/'),
  { ...section('/diary'), title: ru.mobileNavigation.food },
  section('/workouts'),
  { href: '/more', title: ru.mobileNavigation.more, icon: IconDots },
];
export const moreSections = [
  '/measurements',
  '/analytics',
  '/anamnesis',
  '/reports',
  '/settings',
].map((href) => sections.find((section) => section.href === href)!);
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === '/more')
    return (
      pathname === '/more' ||
      moreSections.some((section) => isSectionActive(pathname, section.href))
    );
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}
