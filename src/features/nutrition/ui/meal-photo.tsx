'use client';

import { useEffect, useRef } from 'react';
import { Image, UnstyledButton } from '@mantine/core';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';
import { diaryMessages as m } from './messages';
import classes from './diary-view.module.css';

export function MealPhoto({
  src,
  alt,
  privatePhoto,
}: {
  src: string;
  alt: string;
  privatePhoto: boolean;
}) {
  const viewer = useRef<PhotoSwipe | null>(null);

  useEffect(() => {
    return () => {
      viewer.current?.destroy();
      viewer.current = null;
    };
  }, [src, alt, privatePhoto]);

  return (
    <UnstyledButton
      className={classes.photoOpen}
      aria-label={`${m.enlargePhoto}: ${alt}`}
      onClick={(event) => {
        const image = event.currentTarget.querySelector('img');
        if (!image?.naturalWidth || !image.naturalHeight || viewer.current)
          return;

        const lightbox = new PhotoSwipe({
          dataSource: [
            {
              src,
              alt,
              width: image.naturalWidth,
              height: image.naturalHeight,
              element: image,
            },
          ],
          mainClass: classes.photoViewer,
          closeTitle: m.closePhoto,
          zoomTitle: m.photoZoom,
          errorMsg: m.photoLoadError,
          arrowPrev: false,
          arrowNext: false,
          counter: false,
        });
        // The thumbnail uses object-fit: contain inside a 4:3 frame.
        // Animate from the actual image bounds, excluding its letterboxing.
        lightbox.addFilter('thumbBounds', () => {
          const rect = image.getBoundingClientRect();
          const scale = Math.min(
            rect.width / image.naturalWidth,
            rect.height / image.naturalHeight,
          );
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          return {
            x: rect.x + (rect.width - width) / 2,
            y: rect.y + (rect.height - height) / 2,
            w: width,
          };
        });
        lightbox.on('firstUpdate', () => {
          lightbox.element?.setAttribute('aria-label', m.photoViewer);
          lightbox.element?.setAttribute('aria-modal', 'true');
          if (privatePhoto)
            lightbox.element?.setAttribute('data-offline-private', 'true');
        });
        lightbox.on('destroy', () => {
          viewer.current = null;
        });
        viewer.current = lightbox;
        lightbox.init();
      }}
    >
      <Image
        src={src}
        alt={alt}
        radius="md"
        mah={260}
        style={{ aspectRatio: '4 / 3' }}
        fit="contain"
      />
    </UnstyledButton>
  );
}
