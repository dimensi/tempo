'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Group, Loader, Text } from '@mantine/core';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import styles from './teaching-video.module.css';
import { workoutMessages as m } from './messages';
export function TeachingVideo({ src }: { src: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const element = document.createElement('video-js');
    element.classList.add('vjs-big-play-centered');
    element.setAttribute('aria-label', m.video);
    host.current.appendChild(element);
    const player = videojs(element, {
      controls: true,
      autoplay: false,
      preload: 'none',
      fluid: true,
      responsive: false,
      controlBar: {
        volumePanel: { inline: false },
        children: [
          'playToggle',
          'volumePanel',
          'progressControl',
          'remainingTimeDisplay',
          'playbackRateMenuButton',
          'fullscreenToggle',
        ],
      },
      playsinline: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      sources: [{ src, type: 'video/mp4' }],
    });
    player.on('loadstart', () => setLoading(true));
    player.on('waiting', () => setLoading(true));
    player.on('canplay', () => setLoading(false));
    player.on('playing', () => setLoading(false));
    player.on('error', () => {
      setLoading(false);
      setFailed(true);
    });
    return () => {
      if (!player.isDisposed()) player.dispose();
    };
  }, [src]);
  return (
    <div>
      {loading && !failed && (
        <Group role="status" gap="xs">
          <Loader size="sm" />
          <Text size="sm">{m.videoLoading}</Text>
        </Group>
      )}
      {failed && (
        <Alert role="alert" color="red">
          {m.videoError}
        </Alert>
      )}
      <div ref={host} className={styles.player} data-vjs-player />
    </div>
  );
}
