'use client';
import { useEffect, useState } from 'react';
import { Alert, Stack, Text } from '@mantine/core';
import type { OfflineAnamnesis } from '@/contracts/offline-anamnesis';
import { savedMedicalSummary, clientReads } from '@/lib/client-read';
import { useReadRefresh } from '@/lib/use-read-refresh';
import {
  AnamnesisWorkspace,
  MarkerDetail,
  DocumentViewer,
} from '@/features/anamnesis';
import { offlineMessages as m } from '@/config/offline';
export function OfflineAnamnesis({ url, owner }: { url: URL; owner: boolean }) {
  const [data, setData] = useState<OfflineAnamnesis>();
  const revision = useReadRefresh();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    void savedMedicalSummary()
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    if (!data) return;
    const match = url.pathname.match(
      /^\/anamnesis\/(markers|documents)\/([^/]+)$/,
    );
    if (match && !navigator.onLine) {
      const query = `ownerId=${encodeURIComponent(data.ownerId)}`;
      void clientReads
        .read(`/api/anamnesis/${match[1]}/${match[2]}?${query}`)
        .then(() => {
          if (active) setMissing(false);
        })
        .catch(() => {
          if (active) setMissing(true);
        });
    } else
      void Promise.resolve().then(() => {
        if (active) setMissing(false);
      });
    return () => {
      active = false;
    };
  }, [url.pathname, data, revision]);
  if (!data || missing) return <Alert>{m.unknown}</Alert>;
  const marker = url.pathname.match(/^\/anamnesis\/markers\/([^/]+)$/);
  const document = url.pathname.match(/^\/anamnesis\/documents\/([^/]+)$/);
  return (
    <Stack>
      {!data.complete && <Text c="dimmed">{m.partial}</Text>}
      {marker?.[1] ? (
        <MarkerDetail
          ownerId={data.ownerId}
          markerId={decodeURIComponent(marker[1])}
          writable={owner}
        />
      ) : document?.[1] ? (
        <DocumentViewer
          ownerId={data.ownerId}
          documentId={decodeURIComponent(document[1])}
          writable={owner}
        />
      ) : (
        <AnamnesisWorkspace
          ownerId={data.ownerId}
          initial={data.overview}
          writable={owner}
        />
      )}
    </Stack>
  );
}
