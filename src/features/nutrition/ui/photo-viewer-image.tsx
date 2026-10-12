'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { Box, Button, Group, Image } from '@mantine/core';
import { diaryMessages as m } from './messages';
import classes from './diary-view.module.css';

type Point = { x: number; y: number };
const distance = (points: Point[]) => {
  const [first, second] = points;
  return first && second
    ? Math.max(1, Math.hypot(first.x - second.x, first.y - second.y))
    : 1;
};

/** Only this image surface owns touch gestures; page zoom remains available. */
export function PhotoViewerImage({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const points = useRef(new Map<number, Point>());
  const gesture = useRef<{ distance: number; zoom: number } | null>(null);
  const changeZoom = (value: number) => {
    setZoom(Math.max(1, Math.min(4, value)));
    setOffset({ x: 0, y: 0 });
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const previous = points.current.get(event.pointerId);
    if (!previous) return;
    points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = [...points.current.values()];
    if (active.length === 2 && gesture.current) {
      changeZoom(
        (gesture.current.zoom * distance(active)) / gesture.current.distance,
      );
    } else if (active.length === 1 && zoom > 1) {
      const box = event.currentTarget.getBoundingClientRect();
      const limitX = (box.width * (zoom - 1)) / 2;
      const limitY = (box.height * (zoom - 1)) / 2;
      setOffset((old) => ({
        x: Math.max(
          -limitX,
          Math.min(limitX, old.x + event.clientX - previous.x),
        ),
        y: Math.max(
          -limitY,
          Math.min(limitY, old.y + event.clientY - previous.y),
        ),
      }));
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    points.current.delete(event.pointerId);
    gesture.current = null;
  };
  return (
    <>
      <Group justify="center" gap="xs" mb="xs">
        <Button
          variant="default"
          miw={44}
          mih={44}
          aria-label={m.zoomOut}
          disabled={zoom <= 1}
          onClick={() => changeZoom(zoom / 1.5)}
        >
          −
        </Button>
        <Button variant="default" mih={44} onClick={() => changeZoom(1)}>
          {m.resetZoom}
        </Button>
        <Button
          variant="default"
          miw={44}
          mih={44}
          aria-label={m.zoomIn}
          disabled={zoom >= 4}
          onClick={() => changeZoom(zoom * 1.5)}
        >
          +
        </Button>
      </Group>
      <Box
        className={classes.viewerSurface}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch') return;
          event.currentTarget.setPointerCapture(event.pointerId);
          points.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          const active = [...points.current.values()];
          if (active.length === 2)
            gesture.current = { distance: distance(active), zoom };
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <Image
          src={src}
          alt={alt}
          draggable={false}
          className={classes.viewerImage}
          fit="contain"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          }}
        />
      </Box>
    </>
  );
}
