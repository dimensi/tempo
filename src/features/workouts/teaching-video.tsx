'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@mantine/core';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { workoutMessages as m } from './messages';
export function TeachingVideo({ src }: { src: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
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
      responsive: true,
      playsinline: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      sources: [{ src, type: 'video/mp4' }],
    });
    player.on('error', () => setFailed(true));
    return () => {
      if (!player.isDisposed()) player.dispose();
    };
  }, [src]);
  return (
    <div>
      {failed && (
        <Alert role="alert" color="red">
          {m.videoError}
        </Alert>
      )}
      <div ref={host} data-vjs-player />
    </div>
  );
}
