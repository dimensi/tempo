import { SectionPlaceholder } from '@/components/shared/section-placeholder';
import { ru } from '@/config/messages';
export const metadata = { title: 'Замеры' };
export default function Page() {
  const section = ru.sections[2]!;
  return (
    <SectionPlaceholder
      title={section.title}
      description={section.description}
    />
  );
}
