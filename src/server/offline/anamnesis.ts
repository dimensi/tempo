import 'server-only';
import { getAccessibleOwnerId } from '@/server/access/owner';
import {
  getAnamnesisOverview,
  listAnamnesisMarkers,
  listAnamnesisDocuments,
  listAnamnesisReports,
  AnamnesisError,
} from '@/server/anamnesis';
import { offlineAnamnesisSchema } from '@/contracts/offline-anamnesis';
import { offlineIdentity } from './index';
import { OfflineError } from './errors';
/** Compact authorized summaries only. No OCR, file reads or upstream requests. */
export async function offlineAnamnesis(headers: Headers) {
  const identityUrl = new URL('https://local/api/offline/identity');
  const before = await offlineIdentity(headers, identityUrl);
  const ownerId = await getAccessibleOwnerId(headers);
  if (!ownerId) throw new OfflineError(403, 'OFFLINE_ACCESS_DENIED');
  try {
    const [overview, markers, documents, reports] = await Promise.all([
      getAnamnesisOverview(headers, ownerId),
      listAnamnesisMarkers(headers, ownerId),
      listAnamnesisDocuments(headers, ownerId),
      listAnamnesisReports(headers, ownerId),
    ]);
    const after = await offlineIdentity(headers, identityUrl);
    if (
      before.partition !== after.partition ||
      before.connectionGeneration !== after.connectionGeneration
    )
      throw new OfflineError(409, 'OFFLINE_CONNECTION_CHANGED');
    const value = offlineAnamnesisSchema.parse({
      version: 1,
      ownerId,
      overview,
      markers: markers.slice(0, 1000),
      documents: documents.slice(0, 1000),
      reports: reports.slice(0, 200),
      complete:
        markers.length <= 1000 &&
        documents.length <= 1000 &&
        reports.length <= 200,
    });
    while (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024) {
      value.complete = false;
      if (value.documents.length) value.documents.pop();
      else if (value.reports.length) value.reports.pop();
      else if (value.markers.length) value.markers.pop();
      else break;
    }
    return {
      partition: after.partition,
      connectionGeneration: after.connectionGeneration,
      data: value,
    };
  } catch (error) {
    // Missing medical permission must not disable the other saved sections.
    if (error instanceof AnamnesisError && error.status === 403) return null;
    throw error;
  }
}
