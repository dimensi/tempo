import type { MetadataRoute } from 'next';
import { ru } from '@/config/messages';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ru.appName,
    short_name: ru.appName,
    description: 'Личное пространство питания и тренировок',
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#025446',
    theme_color: '#087f5b',
    icons: [
      {
        src: '/branding/app-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/branding/app-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/branding/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
