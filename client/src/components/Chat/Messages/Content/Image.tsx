import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Skeleton } from '@librechat/client';
import { apiBaseUrl } from 'librechat-data-provider';
import { ImageOff } from '~/components/icons';
import DialogImage from './DialogImage';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Max display height for chat images (Tailwind JIT class) */
export const IMAGE_MAX_H = 'max-h-[45vh]' as const;
/** Matches the `max-w-lg` Tailwind class on the wrapper button (32rem = 512px at 16px base) */
const IMAGE_MAX_W_PX = 512;
/** Attachment thumbnails match the file card column: w-64 = 256px, capped
 *  square-ish so a photo never towers over the document cards beside it
 *  (owner 19.08: «фото слишком большую карточку занимает»). */
const THUMBNAIL_MAX_PX = 256;

/** Caches image dimensions by src so remounts can reserve space */
const dimensionCache = new Map<string, { width: number; height: number }>();
/** Tracks URLs that have been fully painted — skip skeleton on remount */
const paintedUrls = new Set<string>();

/** Test-only: resets module-level caches */
export function _resetImageCaches(): void {
  dimensionCache.clear();
  paintedUrls.clear();
}

function computeHeightStyle(w: number, h: number, thumbnail: boolean): React.CSSProperties {
  if (thumbnail) {
    return {
      height: `min(${THUMBNAIL_MAX_PX}px, ${(h / w) * 100}vw, ${(h / w) * THUMBNAIL_MAX_PX}px)`,
    };
  }
  return { height: `min(45vh, ${(h / w) * 100}vw, ${(h / w) * IMAGE_MAX_W_PX}px)` };
}

const Image = ({
  imagePath,
  altText,
  className,
  args,
  width,
  height,
  thumbnail = false,
}: {
  imagePath: string;
  altText: string;
  className?: string;
  args?: {
    prompt?: string;
    quality?: 'low' | 'medium' | 'high';
    size?: string;
    style?: string;
    [key: string]: unknown;
  };
  width?: number;
  height?: number;
  /** Message ATTACHMENTS render as thumbnails on the file-card column width
   *  (256px cap); generated images keep the large 45vh/512px presentation. */
  thumbnail?: boolean;
}) => {
  const localize = useLocalize();
  const [isOpen, setIsOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const absoluteImageUrl = useMemo(() => {
    if (!imagePath) return imagePath;

    if (
      imagePath.startsWith('http') ||
      imagePath.startsWith('data:') ||
      !imagePath.startsWith('/images/')
    ) {
      return imagePath;
    }

    const baseURL = apiBaseUrl();
    return `${baseURL}${imagePath}`;
  }, [imagePath]);

  const downloadImage = async () => {
    try {
      const response = await fetch(absoluteImageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = altText || 'image.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      const link = document.createElement('a');
      link.href = absoluteImageUrl;
      link.download = altText || 'image.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  useEffect(() => {
    if (width && height && absoluteImageUrl) {
      dimensionCache.set(absoluteImageUrl, { width, height });
    }
  }, [absoluteImageUrl, width, height]);

  useEffect(() => {
    setFailed(false);
  }, [absoluteImageUrl]);

  const dims = width && height ? { width, height } : dimensionCache.get(absoluteImageUrl);
  const hasDimensions = !!(dims?.width && dims?.height);
  const heightStyle = hasDimensions
    ? computeHeightStyle(dims.width, dims.height, thumbnail)
    : undefined;
  const showSkeleton = hasDimensions && !paintedUrls.has(absoluteImageUrl);

  /* A photo that never loads must NOT keep its reserved box: the pre-fix
   * state was a permanently shimmering skeleton inside up to 45vh of empty
   * frame (owner 19.08: «полоса», «карточка неадекватно высокая»). Degrade to
   * a file-card-sized plate that names the file and the state. */
  if (failed) {
    return (
      <div
        className={cn(
          'mt-1 flex w-64 max-w-full items-center gap-2 rounded-xl border border-border-light bg-surface-primary p-1.5 text-sm',
          className,
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center">
          <ImageOff className="h-[22px] w-[22px] text-text-secondary" aria-hidden="true" />
        </span>
        <span className="overflow-hidden">
          <span className="block truncate font-medium text-text-primary">{altText}</span>
          <span className="block truncate text-text-secondary">
            {localize('com_ui_image_unavailable')}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`View ${altText} in dialog`}
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
        className={cn(
          'relative mt-1 w-full cursor-pointer overflow-hidden rounded-lg border border-border-light text-text-secondary-alt shadow-sm transition-shadow',
          'focus:outline-none',
          thumbnail ? 'max-w-64' : 'max-w-lg',
          className,
        )}
        style={heightStyle}
      >
        {showSkeleton && <Skeleton className="absolute inset-0" aria-hidden="true" />}
        <img
          alt={altText}
          src={absoluteImageUrl}
          onLoad={() => paintedUrls.add(absoluteImageUrl)}
          onError={() => setFailed(true)}
          className={cn(
            'relative block text-transparent',
            hasDimensions
              ? 'size-full object-contain'
              : cn('h-auto w-auto max-w-full', thumbnail ? 'max-h-64' : IMAGE_MAX_H),
          )}
        />
      </button>
      <DialogImage
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={absoluteImageUrl}
        downloadImage={downloadImage}
        args={args}
        triggerRef={triggerRef}
      />
    </div>
  );
};

export default Image;
