import { SectionPlaceholder } from '@/components/shared/section-placeholder';
import { ru } from '@/config/messages';
export const metadata = { title: 'Аналитика' };
export default function Page() {
  const section = ru.sections[4]!;
  return (
    <SectionPlaceholder
      title={section.title}
      description={section.description}
    />
  );
}
