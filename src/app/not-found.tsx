'use client';

import Link from 'next/link';
import { Container, Title, Text, Button, Stack } from '@mantine/core';
export default function NotFound() {
  return (
    <Container py="xl">
      <Stack>
        <Title>Страница не найдена</Title>
        <Text>Проверьте адрес или вернитесь к обзору.</Text>
        <Button component={Link} href="/">
          К обзору
        </Button>
      </Stack>
    </Container>
  );
}
