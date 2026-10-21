import 'server-only';
import { inArray } from 'drizzle-orm';
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
      database.sqlite.transaction(() => {
        for (const marker of anamnesisCatalog)
          database.db
            .insert(medicalMarkers)
            .values({
              id: marker.id,
              code: marker.code,
              name: marker.name,
              shortName: marker.shortName,
              category: marker.category,
              description: marker.description,
              preferredUnit: marker.preferredUnit,
              definitionVersion: 2,
            })
            .onConflictDoUpdate({
              target: medicalMarkers.id,
              set: {
                name: marker.name,
                shortName: marker.shortName,
                category: marker.category,
                description: marker.description,
                preferredUnit: marker.preferredUnit,
                definitionVersion: 2,
              },
            })
            .run();
        // Code owns these aliases; remove obsolete broad synonyms as well as adding new ones.
        database.db
          .delete(medicalMarkerAliases)
          .where(
            inArray(
              medicalMarkerAliases.markerId,
              anamnesisCatalog.map((marker) => marker.id),
            ),
          )
          .run();
        const aliases = anamnesisCatalog.flatMap((marker) =>
          [
            ...new Set(
              [marker.name, marker.code, ...marker.aliases]
                .filter((alias): alias is string => alias !== null)
                .map(anamnesisMatchKey),
            ),
          ].map((alias) => ({ id: randomUUID(), markerId: marker.id, alias })),
        );
        database.db.insert(medicalMarkerAliases).values(aliases).run();
      })();
    })();
    seeded.set(database, once);
  }
  return once;
}
