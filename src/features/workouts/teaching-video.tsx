'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Slider, Text } from '@mantine/core';
import { IconChevronLeft, IconMinus, IconPlus } from '@tabler/icons-react';
import { createPortal } from 'react-dom';
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
  const [speed, setSpeed] = useState(1);
  const [picker, setPicker] = useState<{
    target: HTMLElement;
    trigger: HTMLElement;
    change(value: number): void;
  } | null>(null);
  const closePicker = useCallback(() => {
    setPicker(null);
    picker?.trigger.focus();
  }, [picker]);
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
          'fullscreenToggle',
        ],
      },
      playsinline: true,
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      sources: [{ src, type: 'video/mp4' }],
    });
    const rateButton = player.getChild('controlBar')?.addChild(
      'button',
      {
        controlText: m.playbackSpeed,
      },
      4,
    );
    const trigger = rateButton?.el() as HTMLElement | undefined;
    const value = document.createElement('span');
    value.className = 'vjs-speed-value';
    value.setAttribute('aria-hidden', 'true');
    trigger?.appendChild(value);
    trigger?.setAttribute('aria-haspopup', 'dialog');
    const updateSpeed = () => {
      const rate = player.playbackRate() ?? 1;
      value.textContent = `${rate}x`;
      setSpeed(rate);
    };
    updateSpeed();
    player.on('ratechange', updateSpeed);
    rateButton?.on('click', () => {
      if (!trigger) return;
      player.userActive(true);
      setPicker((current) =>
        current
          ? null
          : {
              target: player.el(),
              trigger,
              change: (rate) => player.playbackRate(rate),
            },
      );
    });
    player.on('error', () => {
      setFailed(true);
    });
    return () => {
      setPicker(null);
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
      {picker &&
        createPortal(
          <SpeedPicker
            speed={speed}
            change={picker.change}
            trigger={picker.trigger}
            close={closePicker}
          />,
          picker.target,
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

function SpeedPicker({
  speed,
  change,
  close,
  trigger,
}: {
  speed: number;
  change(value: number): void;
  close(): void;
  trigger: HTMLElement;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus();
    trigger.setAttribute('aria-expanded', 'true');
    const bar = trigger.closest('.vjs-control-bar');
    bar?.classList.add('vjs-lock-showing');
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.contains(event.target)
      )
        close();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      trigger.setAttribute('aria-expanded', 'false');
      bar?.classList.remove('vjs-lock-showing');
      document.removeEventListener('pointerdown', outside);
    };
  }, [close, trigger]);
  const adjust = (delta: number) =>
    change(
      Math.min(2, Math.max(0.25, Math.round((speed + delta) * 100) / 100)),
    );
  return (
    <div
      ref={panel}
      className={styles.speedPanel}
      role="dialog"
      aria-label={m.playbackSpeed}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <Group gap="xs" className={styles.speedHeader} wrap="nowrap">
        <ActionIcon
          ref={back}
          variant="subtle"
          color="gray"
          size={44}
          aria-label={m.closeSpeedPicker}
          onClick={close}
        >
          <IconChevronLeft size={22} />
        </ActionIcon>
        <Text size="sm" fw={500}>
          {m.playbackSpeed}
        </Text>
      </Group>
      <Text className={styles.speedValue} fw={700}>
        {speed.toFixed(2)}x
      </Text>
      <Group gap="sm" wrap="nowrap" className={styles.speedSlider}>
        <ActionIcon
          size={44}
          radius="xl"
          variant="light"
          color="gray"
          aria-label={m.decreaseSpeed}
          disabled={speed <= 0.25}
          onClick={() => adjust(-0.05)}
        >
          <IconMinus size={22} />
        </ActionIcon>
        <Slider
          className={styles.speedRange}
          min={0.25}
          max={2}
          step={0.05}
          value={speed}
          onChange={change}
          label={null}
          thumbLabel={m.playbackSpeed}
          thumbSize={20}
          styles={{
            bar: { background: 'white' },
            track: { background: '#777' },
            thumb: { background: 'white', borderColor: 'white' },
          }}
          color="gray"
        />
        <ActionIcon
          size={44}
          radius="xl"
          variant="light"
          color="gray"
          aria-label={m.increaseSpeed}
          disabled={speed >= 2}
          onClick={() => adjust(0.05)}
        >
          <IconPlus size={22} />
        </ActionIcon>
      </Group>
      <Group gap={6} wrap="nowrap" className={styles.speedPresets}>
        {[1, 1.25, 1.5, 1.75, 2].map((rate) => (
          <Button
            key={rate}
            variant={speed === rate ? 'filled' : 'light'}
            color="gray"
            radius="xl"
            aria-pressed={speed === rate}
            onClick={() => change(rate)}
          >
            {String(rate).replace('.', ',')}
          </Button>
        ))}
      </Group>
    </div>
  );
}
