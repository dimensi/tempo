import classes from './content-layout.module.css';

export function ContentLayout({ children }: { children: React.ReactNode }) {
  return <div className={classes.content}>{children}</div>;
}
