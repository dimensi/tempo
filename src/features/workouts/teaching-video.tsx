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
  autoPlay = false,
}: {
  src: string;
  poster?: string;
  compact?: boolean;
  label?: string;
  autoPlay?: boolean;
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
      autoplay: autoPlay,
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
      const popup = button?.querySelector<HTMLElement>('.vjs-menu');
      if (!button || !menu || !popup) return;
      if (!menu.querySelector('.vjs-speed-heading')) {
        const heading = document.createElement('li');
        heading.className = 'vjs-speed-heading';
        heading.setAttribute('role', 'presentation');
        heading.textContent = m.playbackSpeed;
        menu.prepend(heading);
        menu.setAttribute('aria-label', m.playbackSpeed);
      }
      const video = player.el().getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      const height = Math.min(320, Math.max(44, video.height - 16));
      popup.style.width = `${Math.min(280, Math.max(0, video.width - 16))}px`;
      popup.style.height = `${height}px`;
      popup.style.right = `${bounds.right - video.right + 8}px`;
      popup.style.top = `${video.bottom - 8 - height - bounds.top}px`;
      const selected = menu.querySelector<HTMLElement>('.vjs-selected');
      if (selected)
        menu.scrollTop = Math.max(0, selected.offsetTop - (height - 44) / 2);
    };
    const observer = new ResizeObserver(fitRateMenu);
    observer.observe(player.el());
    player.ready(fitRateMenu);
    rateButton?.on('mouseenter', fitRateMenu);
    rateButton?.on('click', fitRateMenu);
    rateButton?.on('keydown', fitRateMenu);
    player.on('error', () => {
      setFailed(true);
    });
    return () => {
      observer.disconnect();
      if (!player.isDisposed()) player.dispose();
    };
  }, [src, poster, label, autoPlay]);
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
