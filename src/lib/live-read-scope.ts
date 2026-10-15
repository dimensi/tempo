interface Scope {
  partition: string;
  connectionGeneration: string;
  role: string;
}
/** Provider rebinding changes an owner's cache generation, not ownership of the live screen. */
export function canRetainLiveRead(previous: Scope, next: Scope) {
  return (
    previous.partition === next.partition &&
    previous.role === next.role &&
    (previous.role === 'OWNER' ||
      (previous.role === 'TRAINER' &&
        previous.connectionGeneration === next.connectionGeneration))
  );
}
