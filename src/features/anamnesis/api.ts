'use client';

// Общий клиентский доступ к API анамнеза: ownerId всегда в query,
// ошибки приводятся к русским сообщениям.
import { anamnesisMessages as m } from '@/config/anamnesis-messages';

export function anamnesisFetchError(status: number): string {
  if (status === 401) return m.errors.sessionExpired;
  if (status === 403) return m.errors.denied;
  if (status === 429) return m.errors.busy;
  return m.errors.load;
}

export async function fetchAnamnesis<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new AnamnesisFetchError(response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class AnamnesisFetchError extends Error {
  constructor(public readonly status: number) {
    super(`Anamnesis request failed: ${status}`);
  }
}

export function ownerIdQuery(ownerId: string): string {
  return `ownerId=${encodeURIComponent(ownerId)}`;
}

export { formatAnamnesisValue } from '@/contracts/anamnesis';

export function formatAnamnesisDate(value: string | null): string {
  if (!value) return m.unknownDate;
  const date = value.match(/^(\d{4})-(\d{2})(-\d{2})?(T(\d{2}:\d{2}))?/);
  if (date)
    return `${date[3] ? date[3].slice(1) : '??'}.${date[2]}.${date[1]}${date[5] ? ` ${date[5]}` : ''}`;
  return value;
}
