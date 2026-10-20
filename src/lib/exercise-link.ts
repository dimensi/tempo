export function exercisePageHref(id: number) {
  return `/workouts/catalog/${id}`;
}

/** Only canonical exercise pages are valid login destinations. */
export function exerciseReturnTo(value: string | null | undefined) {
  const match = value?.match(/^\/workouts\/catalog\/([1-9][0-9]*)$/);
  return match && Number.isSafeInteger(Number(match[1])) ? value! : undefined;
}
