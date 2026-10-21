/**
 * Utility functions for Product Media Gallery, Slider, and Hover Zoom
 */

/**
 * Builds a clean, deduplicated media sequence consisting of images and optional promotional video.
 *
 * @param {Object} options
 * @param {Array} [options.images] - List of image objects ({ id, image, url, is_primary }) or URL strings
 * @param {Object|string} [options.video] - Product video object ({ video, title, id }) or URL string
 * @param {string} [options.productImg] - Base product image fallback
 * @returns {Array<{ type: 'image'|'video', id: string, url: string, isPrimary?: boolean, title?: string }>}
 */
export function buildMediaSequence({ images = [], video = null, productImg = null } = {}) {
  const sequence = [];
  const seenUrls = new Set();

  // 1. Process images array
  if (Array.isArray(images) && images.length > 0) {
    // Separate primary images from secondary images to prioritize primary
    const primaryImgs = [];
    const otherImgs = [];

    images.forEach((imgItem, idx) => {
      if (!imgItem) return;
      const rawUrl = typeof imgItem === "string" ? imgItem : imgItem.image || imgItem.url;
      if (!rawUrl || typeof rawUrl !== "string") return;

      const trimmed = rawUrl.trim();
      if (!trimmed || seenUrls.has(trimmed)) return;

      const isPrimary = typeof imgItem === "object" ? Boolean(imgItem.is_primary) : false;
      const id = (typeof imgItem === "object" && imgItem.id) ? String(imgItem.id) : `img-${idx}`;

      const item = {
        type: "image",
        id,
        url: trimmed,
        isPrimary,
        is_primary: isPrimary,
      };

      if (isPrimary) {
        primaryImgs.push(item);
      } else {
        otherImgs.push(item);
      }
      seenUrls.add(trimmed);
    });

    sequence.push(...primaryImgs, ...otherImgs);
  }

  // 2. Base product image if not already included
  if (productImg && typeof productImg === "string") {
    const trimmedBase = productImg.trim();
    if (trimmedBase && !seenUrls.has(trimmedBase)) {
      seenUrls.add(trimmedBase);
      // Place at beginning if no primary image exists
      if (sequence.length === 0) {
        sequence.push({
          type: "image",
          id: "base-product-img",
          url: trimmedBase,
          isPrimary: true,
          is_primary: true,
        });
      } else {
        sequence.push({
          type: "image",
          id: "base-product-img",
          url: trimmedBase,
          isPrimary: false,
          is_primary: false,
        });
      }
    }
  }

  // 3. Process video if available
  if (video) {
    let videoUrl = null;
    let videoTitle = "Product Promotional Video";
    let videoId = "video-main";

    if (typeof video === "string") {
      videoUrl = video.trim();
    } else if (typeof video === "object") {
      videoUrl = video.video || video.url || null;
      if (typeof videoUrl === "string") videoUrl = videoUrl.trim();
      if (video.title) videoTitle = String(video.title).trim();
      if (video.id) videoId = String(video.id);
    }

    if (videoUrl) {
      sequence.push({
        type: "video",
        id: videoId,
        url: videoUrl,
        title: videoTitle,
      });
    }
  }

  return sequence;
}

/**
 * Calculates clamped percentage coordinates (0% - 100%) for hover zoom magnification.
 *
 * @param {number} clientX
 * @param {number} clientY
 * @param {{ left: number, top: number, width: number, height: number }} bounds
 * @returns {{ x: number, y: number }}
 */
export function calculateZoomCoordinates(clientX, clientY, bounds) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 50, y: 50 };
  }

  const rawX = ((clientX - bounds.left) / bounds.width) * 100;
  const rawY = ((clientY - bounds.top) / bounds.height) * 100;

  const clampedX = Math.max(0, Math.min(100, rawX));
  const clampedY = Math.max(0, Math.min(100, rawY));

  return {
    x: Number(clampedX.toFixed(2)),
    y: Number(clampedY.toFixed(2)),
  };
}

/**
 * Computes the next media index, wrapping around when reaching the sequence end if loop is true.
 *
 * @param {number} currentIndex
 * @param {number} totalItems
 * @param {boolean} [loop=true]
 * @returns {number}
 */
export function getNextMediaIndex(currentIndex, totalItems, loop = true) {
  if (!totalItems || totalItems <= 1) return 0;
  if (!loop) {
    return Math.min(currentIndex + 1, totalItems - 1);
  }
  return (currentIndex + 1) % totalItems;
}

/**
 * Computes the previous media index, wrapping around when reaching the sequence start if loop is true.
 *
 * @param {number} currentIndex
 * @param {number} totalItems
 * @param {boolean} [loop=true]
 * @returns {number}
 */
export function getPrevMediaIndex(currentIndex, totalItems, loop = true) {
  if (!totalItems || totalItems <= 1) return 0;
  if (!loop) {
    return Math.max(currentIndex - 1, 0);
  }
  return (currentIndex - 1 + totalItems) % totalItems;
}

/**
 * Creates a media playback controller for synchronizing product images and video playback.
 * Ensures:
 * - Only currently active media item is displayed.
 * - Image timer is scheduled ONLY for images, not videos.
 * - When video becomes active, timer is immediately paused and cleared.
 * - Video ended event advances exactly once to next media item.
 * - If video is final item and loop is false, playback stops at the video.
 *
 * @param {Object} options
 * @param {Array} options.sequence
 * @param {number} [options.imageDuration=3000]
 * @param {boolean} [options.loop=true]
 * @param {Function} [options.onIndexChange]
 */
export function createMediaPlaybackController({
  sequence = [],
  imageDuration = 3000,
  loop = true,
  onIndexChange,
} = {}) {
  let currentIndex = 0;
  let timerId = null;
  let isVideoPlaying = false;
  let hasEnded = false;

  const clearTimer = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const getActiveItem = () => sequence[currentIndex] || null;

  const advance = () => {
    clearTimer();
    const nextIndex = getNextMediaIndex(currentIndex, sequence.length, loop);
    if (nextIndex !== currentIndex) {
      currentIndex = nextIndex;
      hasEnded = false;
      isVideoPlaying = false;
      if (onIndexChange) onIndexChange(currentIndex, getActiveItem());
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    clearTimer();
    const current = getActiveItem();
    if (!current || sequence.length <= 1) return;

    if (current.type === "image") {
      timerId = setTimeout(() => {
        advance();
      }, imageDuration);
    }
    // If video, NO timer is scheduled! Video progression relies strictly on onVideoEnded.
  };

  const onVideoEnded = () => {
    const current = getActiveItem();
    if (current?.type !== "video" || hasEnded) return;
    hasEnded = true;
    isVideoPlaying = false;
    advance();
  };

  const onVideoPlay = () => {
    clearTimer();
    isVideoPlaying = true;
    hasEnded = false;
  };

  const onVideoPause = () => {
    isVideoPlaying = false;
    // Remains paused, does not advance automatically
  };

  const selectIndex = (index) => {
    clearTimer();
    const valid = Math.max(0, Math.min(index, sequence.length - 1));
    currentIndex = valid;
    hasEnded = false;
    isVideoPlaying = false;
    if (onIndexChange) onIndexChange(currentIndex, getActiveItem());
    scheduleNext();
  };

  return {
    getCurrentIndex: () => currentIndex,
    getActiveItem,
    isTimerActive: () => Boolean(timerId),
    isVideoPlaying: () => isVideoPlaying,
    scheduleNext,
    advance,
    onVideoEnded,
    onVideoPlay,
    onVideoPause,
    selectIndex,
    destroy: () => clearTimer(),
  };
}
