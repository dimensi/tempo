import Image from 'next/image';

/** Decorative beside the application name; the adjacent text supplies its label. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/branding/mark.svg"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      unoptimized
      style={{ flexShrink: 0 }}
    />
  );
}
