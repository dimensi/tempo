import { Center, Loader } from '@mantine/core';
export default function Loading() {
  return (
    <Center mih={240} role="status" aria-label="Загрузка">
      <Loader />
    </Center>
  );
}
