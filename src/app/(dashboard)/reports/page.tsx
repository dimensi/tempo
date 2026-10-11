import { SectionPlaceholder } from '@/components/shared/section-placeholder';
import { ru } from '@/config/messages';
export const metadata = { title: 'Отчёты' };
export default function Page() {
  const section = ru.sections[5]!;
  return (
    <SectionPlaceholder
      title={section.title}
      description={section.description}
    />
  );
}
