import { createTheme } from '@mantine/core';
export const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'md',
  fontFamily: 'Arial, system-ui, sans-serif',
  headings: { fontFamily: 'Arial, system-ui, sans-serif', fontWeight: '700' },
  components: {
    Button: { defaultProps: { size: 'md' } },
    ActionIcon: { defaultProps: { size: 44 } },
  },
});
