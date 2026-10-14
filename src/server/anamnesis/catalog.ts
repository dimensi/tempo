import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '@/server/db';
import {
  medicalMarkers,
  medicalMarkerAliases,
} from '@/server/db/schema/anamnesis';
import { anamnesisCatalog, anamnesisMatchKey } from './markers';

type Database = ReturnType<typeof getDatabase>;
const seeded = new WeakMap<object, Promise<void>>();

// Идемпотентный сид каталога; безопасно вызывать на каждом обращении.
export function ensureAnamnesisCatalog(database: Database = getDatabase()) {
  let once = seeded.get(database);
  if (!once) {
    once = (async () => {
      await database.db
        .insert(medicalMarkers)
        .values(
          anamnesisCatalog.map((marker) => ({
            id: marker.id,
            code: marker.code,
            name: marker.name,
            shortName: marker.shortName,
            category: marker.category,
            description: marker.description,
            preferredUnit: marker.preferredUnit,
            definitionVersion: 1,
          })),
        )
        .onConflictDoNothing({ target: medicalMarkers.id });
      await database.db
        .insert(medicalMarkerAliases)
        .values(
          anamnesisCatalog.flatMap((marker) =>
            marker.aliases.map((alias) => ({
              id: randomUUID(),
              markerId: marker.id,
              alias: anamnesisMatchKey(alias),
            })),
          ),
        )
        .onConflictDoNothing({ target: medicalMarkerAliases.alias });
    })();
    seeded.set(database, once);
  }
  return once;
}
