'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@mantine/core';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import styles from './teaching-video.module.css';
import { workoutMessages as m } from './messages';
export function TeachingVideo({
  src,
  poster,
  compact = false,
  label = m.video,
}: {
  src: string;
  poster?: string;
  compact?: boolean;
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const element = document.createElement('video-js');
    element.classList.add('vjs-big-play-centered');
    element.setAttribute('aria-label', label);
    host.current.appendChild(element);
    const player = videojs(element, {
      controls: true,
      autoplay: false,
      poster,
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
    const rateButton = player
      .getChild('controlBar')
      ?.getChild('playbackRateMenuButton');
    const fitRateMenu = () => {
      const button = rateButton?.el();
      const menu = button?.querySelector<HTMLElement>('.vjs-menu-content');
      if (!button || !menu || !host.current) return;
      const popup = button.querySelector<HTMLElement>('.vjs-menu');
      const bounds = button.getBoundingClientRect();
      const header = document.fullscreenElement
        ? 0
        : (document
            .querySelector('.mantine-AppShell-header')
            ?.getBoundingClientRect().bottom ?? 0);
      const above = bounds.top - header - 8;
      const downward = above < 44;
      if (popup) {
        popup.style.top = downward ? '44px' : '';
        popup.style.bottom = downward ? 'auto' : '';
      }
      menu.style.top = downward ? '0' : '';
      menu.style.bottom = downward ? 'auto' : '';
      menu.style.maxHeight = `${Math.max(44, downward ? window.innerHeight - bounds.bottom - 8 : above)}px`;
    };
    rateButton?.on('mouseenter', fitRateMenu);
    rateButton?.on('click', fitRateMenu);
    rateButton?.on('keydown', fitRateMenu);
    player.on('error', () => {
      setFailed(true);
    });
    return () => {
      if (!player.isDisposed()) player.dispose();
    };
  }, [src, poster, label]);
  return (
    <div>
      {failed && (
        <Alert role="alert" color="red">
          {m.videoError}
        </Alert>
      )}
      <div
        ref={host}
        className={styles.player}
        style={compact ? { maxWidth: 320 } : undefined}
        data-vjs-player
      />
    </div>
  );
}
