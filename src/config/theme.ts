import {
  ActionIcon,
  Button,
  createTheme,
  parseThemeColor,
} from '@mantine/core';
import classes from '@/config/action-controls.module.css';
export const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'md',
  fontFamily: 'Arial, system-ui, sans-serif',
  headings: { fontFamily: 'Arial, system-ui, sans-serif', fontWeight: '700' },
  components: {
    Button: Button.extend({
      defaultProps: { size: 'md' },
      classNames: { root: classes.control },
      vars: (theme, props) => {
        const color = parseThemeColor({
          color: props.color ?? theme.primaryColor,
          theme,
        });
        if (props.variant !== 'subtle' && props.variant !== 'light')
          return { root: {} };
        return {
          root: {
            '--button-color': color.isThemeColor
              ? `light-dark(color-mix(in srgb, var(--mantine-color-${color.color}-9) 80%, black), var(--mantine-color-${color.color}-3))`
              : color.value,
          },
        };
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { size: 44 },
      classNames: { root: classes.control },
      vars: (theme, props) => {
        const color = parseThemeColor({
          color: props.color ?? theme.primaryColor,
          theme,
        });
        if (props.variant !== 'subtle' && props.variant !== 'light')
          return { root: {} };
        return {
          root: {
            '--ai-color': color.isThemeColor
              ? `light-dark(color-mix(in srgb, var(--mantine-color-${color.color}-9) 80%, black), var(--mantine-color-${color.color}-3))`
              : color.value,
          },
        };
      },
    }),
  },
});
