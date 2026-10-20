import { Container, Stack, Title, Text } from '@mantine/core';
import { LoginForm } from '@/components/shared/login-form';
import { consentQuery, validMcpQuery } from '@/server/mcp/consent';
import { mcpMessages as messages } from '@/config/mcp-messages';
export const metadata = {
  title: 'Tempo MCP',
  robots: { index: false, follow: false },
};
export default async function McpLogin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = consentQuery(await searchParams);
  const valid = await validMcpQuery(query);
  return (
    <Container size={440} py={80}>
      <Stack gap="lg">
        <Title order={1}>{messages.login}</Title>
        {valid ? (
          <LoginForm returnTo={`/api/auth/oauth2/authorize?${query}`} />
        ) : (
          <Text role="alert">{messages.invalid}</Text>
        )}
      </Stack>
    </Container>
  );
}
