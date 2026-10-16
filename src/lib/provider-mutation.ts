import { revalidateVisibleReads } from './client-read';
/** Provider writes refresh data; they are not authentication transitions. */
export async function refreshAfterMutation<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } finally {
    revalidateVisibleReads();
  }
}
