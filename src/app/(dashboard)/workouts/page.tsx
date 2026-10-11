import { SectionPlaceholder } from '@/components/shared/section-placeholder';
import { ru } from '@/config/messages';
export const metadata = { title: 'Тренировки' };
export default function Page() {
  const section = ru.sections[3]!;
  return (
    <SectionPlaceholder
      title={section.title}
      description={section.description}
    />
  );
}
