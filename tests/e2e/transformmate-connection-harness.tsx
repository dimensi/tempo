import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { TransformMateSettingsForm } from '@/app/(dashboard)/settings/transformmate/settings-form';
createRoot(document.getElementById('root')!).render(
  <MantineProvider>
    <TransformMateSettingsForm
      initial={{
        configured: false,
        account: null,
        checkedAt: null,
        errorCode: null,
      }}
      embedded
    />
  </MantineProvider>,
);
