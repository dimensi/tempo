'use client';
import type { CommentTarget } from '@/contracts/comments';
import { apiFetch } from '@/lib/api-client';
import { readResources } from '@/lib/read-descriptors';
import { useReadOnline } from '@/lib/use-read-online';
import { useReadResource } from '@/lib/use-read-resource';
import { useViewState } from '@/lib/use-view-state';
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useRef, useState } from 'react';
import { commentMessages as m } from './messages';
import { CommentReadContent } from './read';
function TargetCommentsPanel({
  ownerId,
  target,
}: {
  ownerId: string;
  target: CommentTarget;
}) {
  const online = useReadOnline();
  const [body, setBody] = useViewState(
    `comments:${target.type}:${target.id}:body`,
    '',
  );
  const draftRevision = useRef(0);
  const [parentId, setParentId] = useViewState<string | undefined>(
    `comments:${target.type}:${target.id}:parent`,
    undefined,
  );
  const [editing, setEditing] = useViewState<string | undefined>(
    `comments:${target.type}:${target.id}:editing`,
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const targetType = target.type;
  const targetId = target.id;
  const resource = useReadResource(
    readResources.comments(
      `/api/comments?${new URLSearchParams({ ownerId, type: targetType, targetId })}`,
    ),
  );
  const rows = resource.data ?? [];
  const loading = resource.data === undefined && !resource.error;
  const refresh = resource.refresh;
  async function save() {
    if (!online || busy) return;
    const submittedRevision = draftRevision.current;
    setBusy(true);
    setError(false);
    try {
      const response = await apiFetch(
        editing ? `/api/comments/${editing}` : '/api/comments',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            editing
              ? { ownerId, body }
              : {
                  ownerId,
                  target: { type: targetType, id: targetId },
                  body,
                  parentId,
                },
          ),
        },
      );
      if (!response.ok) throw new Error();
      if (draftRevision.current === submittedRevision) {
        draftRevision.current++;
        setBody('');
        setParentId(undefined);
        setEditing(undefined);
      }
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError(false);
    try {
      const response = await apiFetch(`/api/comments/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId }),
      });
      if (!response.ok) throw new Error();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Title order={2}>{m.title}</Title>
      {(error || resource.error) && (
        <Alert color="red" role="alert">
          {m.error}
        </Alert>
      )}
      {loading ? (
        <Text>{m.loading}</Text>
      ) : rows.length === 0 ? (
        <Text c="dimmed">{m.empty}</Text>
      ) : (
        rows.map((row) => (
          <CommentReadContent
            key={row.id}
            authorName={row.authorName}
            body={row.body}
            parentAuthor={
              row.parentId
                ? rows.find((parent) => parent.id === row.parentId)?.authorName
                : undefined
            }
          >
            <Group>
              {!row.parentId && (
                <Button
                  mih={44}
                  variant="subtle"
                  disabled={!online || busy}
                  onClick={() => {
                    draftRevision.current++;
                    setParentId(row.id);
                    setEditing(undefined);
                    setBody('');
                  }}
                >
                  {m.reply}
                </Button>
              )}
              {row.canEdit && (
                <>
                  <Button
                    mih={44}
                    variant="subtle"
                    disabled={!online || busy}
                    onClick={() => {
                      draftRevision.current++;
                      setEditing(row.id);
                      setParentId(undefined);
                      setBody(row.body);
                    }}
                  >
                    {m.edit}
                  </Button>
                  <Button
                    mih={44}
                    variant="subtle"
                    color="red"
                    disabled={!online || busy}
                    onClick={() => void remove(row.id)}
                  >
                    {m.remove}
                  </Button>
                </>
              )}
            </Group>
          </CommentReadContent>
        ))
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Stack>
          {parentId && (
            <Text>
              {m.reply}: {rows.find((row) => row.id === parentId)?.authorName}
            </Text>
          )}
          <Textarea
            label={m.body}
            required
            maxLength={4000}
            autosize
            minRows={3}
            value={body}
            onChange={(e) => {
              draftRevision.current++;
              setBody(e.currentTarget.value);
            }}
          />
          <Group>
            <Button mih={44} type="submit" disabled={loading} loading={busy}>
              {editing ? m.save : m.send}
            </Button>
            {(editing || parentId) && (
              <Button
                mih={44}
                variant="subtle"
                onClick={() => {
                  draftRevision.current++;
                  setEditing(undefined);
                  setParentId(undefined);
                  setBody('');
                }}
              >
                {m.cancel}
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

export function CommentsPanel(props: {
  ownerId: string;
  target: CommentTarget;
}) {
  return (
    <TargetCommentsPanel
      key={`${props.ownerId}:${props.target.type}:${props.target.id}`}
      {...props}
    />
  );
}
