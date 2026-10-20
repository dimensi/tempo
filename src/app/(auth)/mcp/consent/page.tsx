import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Button, Container, Group, Stack, Text, Title } from '@mantine/core';
import { getAuth } from '@/server/auth';
import {
  consentQuery,
  validMcpQuery,
  completeMcpConsent,
} from '@/server/mcp/consent';
import { mcpMessages as messages } from '@/config/mcp-messages';
export const metadata = {
  title: 'Tempo MCP',
  robots: { index: false, follow: false },
};

async function decide(form: FormData) {
  'use server';
  const query = String(form.get('query') ?? '');
  const requestHeaders = await headers();
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (session?.user.role !== 'OWNER' || !(await validMcpQuery(query)))
    redirect('/mcp/consent?error=1');
  let target: string;
  try {
    target = await completeMcpConsent(
      new Headers(requestHeaders),
      query,
      form.get('decision') === 'allow',
    );
  } catch {
    redirect('/mcp/consent?error=1');
  }
  redirect(target);
}
export default async function McpConsent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = consentQuery(await searchParams);
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const valid = await validMcpQuery(query);
  if (valid && !session) redirect(`/mcp/login?${query}`);
  // Only the signed registered client identity is displayed, never remote logos/HTML.
  const clientId = new URLSearchParams(query).get('client_id');
  return (
    <Container size={520} py={80}>
      <Stack gap="lg">
        <Title order={1}>{messages.title}</Title>
        {!valid ? (
          <Text role="alert">{messages.invalid}</Text>
        ) : session?.user.role !== 'OWNER' ? (
          <Text role="alert">{messages.ownerOnly}</Text>
        ) : (
          <>
            <Text>{messages.description}</Text>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {clientId}
            </Text>
            <form action={decide}>
              <input type="hidden" name="query" value={query} />
              <Group>
                <Button type="submit" name="decision" value="allow" mih={48}>
                  {messages.allow}
                </Button>
                <Button
                  type="submit"
                  name="decision"
                  value="deny"
                  variant="default"
                  mih={48}
                >
                  {messages.deny}
                </Button>
              </Group>
            </form>
          </>
        )}
      </Stack>
    </Container>
  );
}
