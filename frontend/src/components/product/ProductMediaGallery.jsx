import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ZoomIn,
  Film,
  Image as ImageIcon,
  ShieldCheck,
} from "lucide-react";
import {
  buildMediaSequence,
  calculateZoomCoordinates,
  getNextMediaIndex,
  getPrevMediaIndex,
} from "../../utils/mediaSequence.js";
import { resolveImageUrl, resolveMediaUrl } from "../../services/productService.js";

/**
 * ProductMediaGallery Component
 * Provides:
 * 1. Flipkart-style magnifying hover zoom on desktop.
 * 2. Automatic smooth product image slider with hover pause.
 * 3. Unified sequence playback containing multiple images and promotional video.
 * 4. Responsive mobile touch swipe support and accessibility controls.
 *
 * @param {Object} props
 * @param {Array} props.images - Product images array
 * @param {Object|string} [props.video] - Product video object or URL
 * @param {string} [props.productImg] - Base product image fallback
 * @param {string} props.productName - Product title for alt tags
 * @param {number} [props.imageDuration=3000] - Duration in ms to display each image in auto-slider
 * @param {boolean} [props.loop=true] - Whether media sequence wraps around at the end
 * @param {boolean} [props.inStock=true] - In-stock status for badge
 * @param {number} [props.zoomScale=2.2] - Magnification factor for hover zoom
 * @param {string} [props.activeImageUrl] - External active image for sync
 * @param {Function} [props.onActiveMediaChange] - Callback when active media changes
 */
export default function ProductMediaGallery({
  images = [],
  video = null,
  productImg = null,
  productName = "Product",
  imageDuration = 3000,
  loop = true,
  inStock = true,
  zoomScale = 2.2,
  activeImageUrl = null,
  mediaMode = null,
  onActiveMediaChange,
}) {
  // Construct the unified media sequence
  const mediaSequence = useMemo(() => {
    return buildMediaSequence({ images, video, productImg });
  }, [images, video, productImg]);

  // Active item index in the sequence (Single source of truth)
  const [currentIndex, setCurrentIndex] = useState(0);

  // Auto-play state & pause-on-hover state
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  // Hover zoom state (Feature A)
  const [isZooming, setIsZooming] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 });

  // Video playback & audio state
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoError, setVideoError] = useState(null);

  // Reduced motion preference detection
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Refs
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const touchStartXRef = useRef(null);
  const hasEndedRef = useRef(false);
  const isMountedRef = useRef(true);

  // External sync tracking refs to prevent circular feedback loops
  const prevMediaModePropRef = useRef(mediaMode);
  const prevActiveImagePropRef = useRef(activeImageUrl);
  const lastReportedMediaRef = useRef(null);

  // Clean timer helper: guarantees only one image timer can exist at a time
  const clearImageTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Component mount & unmount safety
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearImageTimer();
    };
  }, [clearImageTimer]);

  // Reset media sequence safely whenever product changes or sequence length changes
  useEffect(() => {
    clearImageTimer();
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {}
    }
    setCurrentIndex(0);
    setIsZooming(false);
    setVideoError(null);
    hasEndedRef.current = false;
    setIsVideoPlaying(false);
  }, [mediaSequence.length, productName, clearImageTimer]);

  const currentItem = mediaSequence[currentIndex] || {
    type: "image",
    url: productImg || "",
    id: "fallback",
  };

  // Safe navigation functions
  const goToIndex = useCallback(
    (newIndex) => {
      if (mediaSequence.length === 0) return;
      clearImageTimer();
      if (videoRef.current) {
        try {
          videoRef.current.pause();
        } catch {}
      }
      const validIndex = Math.max(0, Math.min(newIndex, mediaSequence.length - 1));
      hasEndedRef.current = false;
      setVideoError(null);
      setIsVideoPlaying(false);
      setCurrentIndex(validIndex);
      setIsZooming(false);
    },
    [mediaSequence.length, clearImageTimer]
  );

  const goToNext = useCallback(() => {
    if (mediaSequence.length <= 1) return;
    clearImageTimer();
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {}
    }
    hasEndedRef.current = false;
    setVideoError(null);
    setIsVideoPlaying(false);
    setCurrentIndex((prev) => getNextMediaIndex(prev, mediaSequence.length, loop));
    setIsZooming(false);
  }, [mediaSequence.length, loop, clearImageTimer]);

  const goToPrev = useCallback(() => {
    if (mediaSequence.length <= 1) return;
    clearImageTimer();
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {}
    }
    hasEndedRef.current = false;
    setVideoError(null);
    setIsVideoPlaying(false);
    setCurrentIndex((prev) => getPrevMediaIndex(prev, mediaSequence.length, loop));
    setIsZooming(false);
  }, [mediaSequence.length, loop, clearImageTimer]);

  // Synchronize external activeImageUrl only if explicitly changed from outside
  useEffect(() => {
    if (prevActiveImagePropRef.current !== activeImageUrl) {
      prevActiveImagePropRef.current = activeImageUrl;
      if (!activeImageUrl || mediaSequence.length === 0) return;
      if (lastReportedMediaRef.current?.url === activeImageUrl) return;

      const matchIdx = mediaSequence.findIndex(
        (item) => item.type === "image" && resolveImageUrl(item.url) === resolveImageUrl(activeImageUrl)
      );
      if (matchIdx !== -1 && matchIdx !== currentIndex) {
        goToIndex(matchIdx);
      }
    }
  }, [activeImageUrl, mediaSequence, currentIndex, goToIndex]);

  // Synchronize external mediaMode only if explicitly changed from outside (e.g. "Watch Farm Video" button)
  useEffect(() => {
    if (prevMediaModePropRef.current !== mediaMode) {
      prevMediaModePropRef.current = mediaMode;
      if (mediaMode === "video") {
        const videoIdx = mediaSequence.findIndex((item) => item.type === "video");
        if (videoIdx !== -1 && videoIdx !== currentIndex) {
          goToIndex(videoIdx);
        }
      }
    }
  }, [mediaMode, mediaSequence, currentIndex, goToIndex]);

  // Detect user reduced motion preference
  useEffect(() => {
    try {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mediaQuery.matches);
      const listener = (e) => setPrefersReducedMotion(e.matches);
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", listener);
        return () => mediaQuery.removeEventListener("change", listener);
      }
    } catch {
      // Ignore if matchMedia is unavailable
    }
  }, []);

  // Notify parent of active media changes
  useEffect(() => {
    if (onActiveMediaChange && currentItem) {
      lastReportedMediaRef.current = {
        type: currentItem.type,
        url: currentItem.url,
        index: currentIndex,
      };
      onActiveMediaChange(currentItem, currentIndex);
    }
  }, [currentIndex, currentItem, onActiveMediaChange]);

  // --------------------------------------------------------------------------
  // FEATURES B & C: AUTOMATIC IMAGE SLIDER & VIDEO SEQUENCE PLAYBACK
  // --------------------------------------------------------------------------
  useEffect(() => {
    // 1. Immediately pause and clear image slider timer on each dependency change
    clearImageTimer();

    // 2. If only 1 media item or auto-play is paused / reduced-motion requested, skip scheduling
    if (mediaSequence.length <= 1 || !isAutoPlaying || prefersReducedMotion) {
      return;
    }

    // 3. If mouse is currently hovering, pause the sequence
    if (isHovered) {
      return;
    }

    // 4. CASE 1: Current item is an IMAGE -> schedule imageDuration advance
    if (currentItem.type === "image") {
      timerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        goToNext();
      }, imageDuration);

      return () => {
        clearImageTimer();
      };
    }

    // 5. CASE 2: Current item is a VIDEO -> strictly NO timer is scheduled!
    // Video advancement relies exclusively on video `ended` event or user interaction.
    return () => {
      clearImageTimer();
    };
  }, [
    currentIndex,
    currentItem.type,
    mediaSequence.length,
    isAutoPlaying,
    isHovered,
    imageDuration,
    prefersReducedMotion,
    goToNext,
    clearImageTimer,
  ]);

  // Video event handlers
  const handleVideoEnded = useCallback(() => {
    if (hasEndedRef.current) return; // Prevent duplicate ended handlers
    hasEndedRef.current = true;
    setIsVideoPlaying(false);
    goToNext();
  }, [goToNext]);

  const handleVideoPlay = useCallback(() => {
    hasEndedRef.current = false;
    setIsVideoPlaying(true);
    clearImageTimer();
  }, [clearImageTimer]);

  const handleVideoPause = useCallback(() => {
    setIsVideoPlaying(false);
    // User paused video: gallery must NOT advance automatically
  }, []);

  const handleVideoError = useCallback((e) => {
    console.warn("Product video playback encountered an error:", e);
    setVideoError("Product promotional video could not be loaded.");
    setIsVideoPlaying(false);
  }, []);

  // --------------------------------------------------------------------------
  // FEATURE A: PRODUCT IMAGE ZOOM ON HOVER (FLIPKART STYLE)
  // --------------------------------------------------------------------------
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (currentItem.type === "image") {
      setIsZooming(true);
    }
  };

  const handleMouseMove = (e) => {
    if (currentItem.type !== "image" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const coords = calculateZoomCoordinates(e.clientX, e.clientY, rect);
    setZoomOrigin(coords);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsZooming(false);
    setZoomOrigin({ x: 50, y: 50 });
  };

  // Mobile Touch Gestures (Swipe between media items)
  const handleTouchStart = (e) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartXRef.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartXRef.current;
    // 40px threshold for swipe detection
    if (diff > 40) {
      goToPrev();
    } else if (diff < -40) {
      goToNext();
    }
    touchStartXRef.current = null;
  };

  const resolvedCurrentUrl =
    currentItem.type === "video"
      ? resolveMediaUrl(currentItem.url)
      : resolveImageUrl(currentItem.url);

  return (
    <div className="gv-details-gallery">
      {/* Main Media Showcase Box */}
      <div
        ref={containerRef}
        className={`gv-details-main-img-box gv-media-gallery-stage ${
          isZooming && currentItem.type === "image" ? "is-zooming" : ""
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{
          position: "relative",
          height: "440px",
          borderRadius: "16px",
          overflow: "hidden",
          backgroundColor: currentItem.type === "video" ? "#0a110b" : "#f7faf5",
          border: "1px solid #e1ebe0",
          userSelect: "none",
          cursor: currentItem.type === "image" ? (isZooming ? "crosshair" : "zoom-in") : "default",
        }}
        aria-label={`${productName} media showcase`}
      >
        {/* MEDIA RENDERER */}
        {currentItem.type === "video" && resolvedCurrentUrl ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#000000",
            }}
          >
            <video
              ref={videoRef}
              key={resolvedCurrentUrl}
              src={resolvedCurrentUrl}
              autoPlay
              muted={isMuted}
              playsInline
              controls
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onEnded={handleVideoEnded}
              onError={handleVideoError}
              title={currentItem.title || `${productName} Promotional Video`}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
              }}
            >
              Your browser does not support HTML5 video playback.
            </video>

            {/* Video Error Fallback Card */}
            {videoError && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#0d160e",
                  color: "#ffffff",
                  padding: "24px",
                  textAlign: "center",
                  zIndex: 20,
                }}
              >
                <Film size={44} style={{ color: "#86efac", marginBottom: "12px", opacity: 0.9 }} />
                <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "6px" }}>
                  Video Preview Unavailable
                </h3>
                <p style={{ fontSize: "13px", color: "#9ca3af", maxWidth: "320px", marginBottom: "16px" }}>
                  {videoError}
                </p>
                <button
                  type="button"
                  onClick={goToNext}
                  style={{
                    padding: "8px 18px",
                    backgroundColor: "#166534",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: "pointer",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                  }}
                >
                  Continue to Photos
                </button>
              </div>
            )}

            {/* Video Audio Control Overlay Button */}
            <button
              type="button"
              onClick={() => setIsMuted((prev) => !prev)}
              title={isMuted ? "Unmute promotional video audio" : "Mute video audio"}
              aria-label={isMuted ? "Unmute video" : "Mute video"}
              style={{
                position: "absolute",
                top: "14px",
                right: "14px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                backgroundColor: "rgba(12, 83, 39, 0.88)",
                backdropFilter: "blur(4px)",
                color: "#ffffff",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer",
                zIndex: 15,
                transition: "all 0.2s ease",
              }}
            >
              {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>{isMuted ? "Unmute" : "Muted"}</span>
            </button>
          </div>
        ) : (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "hidden",
            }}
          >
            {/* The Product Image with Zoom Transform (Feature A) */}
            <img
              key={resolvedCurrentUrl}
              src={resolvedCurrentUrl}
              alt={productName}
              loading="eager"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src =
                  "https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=800&q=80";
              }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                transform: isZooming ? `scale(${zoomScale})` : "scale(1)",
                transition: isZooming ? "transform 0.08s ease-out" : "transform 0.3s ease-out",
                pointerEvents: "none",
              }}
            />

            {/* Subtle "Hover to zoom" hint on desktop */}
            {!isZooming && (
              <div
                style={{
                  position: "absolute",
                  bottom: "16px",
                  right: "16px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 10px",
                  backgroundColor: "rgba(255, 255, 255, 0.92)",
                  backdropFilter: "blur(4px)",
                  border: "1px solid #dce8db",
                  borderRadius: "20px",
                  fontSize: "11px",
                  fontWeight: "600",
                  color: "#0c5327",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.08)",
                  pointerEvents: "none",
                  transition: "opacity 0.2s ease",
                }}
              >
                <ZoomIn size={13} />
                <span>Hover to zoom</span>
              </div>
            )}
          </div>
        )}

        {/* Product In-Stock / Organic Status Badge */}
        <div style={{ position: "absolute", top: "16px", left: "16px", zIndex: 12, pointerEvents: "none" }}>
          {inStock ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: "rgba(12, 83, 39, 0.95)",
                backdropFilter: "blur(4px)",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: "700",
                padding: "6px 12px",
                borderRadius: "8px",
                boxShadow: "0 2px 8px rgba(12, 83, 39, 0.2)",
              }}
            >
              <ShieldCheck size={14} /> 100% Certified Organic
            </span>
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                backgroundColor: "#4b5563",
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: "700",
                padding: "6px 12px",
                borderRadius: "8px",
              }}
            >
              Sold Out
            </span>
          )}
        </div>

        {/* Navigation Arrows for Slider (Feature B & C) */}
        {mediaSequence.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goToPrev();
              }}
              title="Previous media"
              aria-label="Previous slide"
              style={{
                position: "absolute",
                top: "50%",
                left: "12px",
                transform: "translateY(-50%)",
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                backgroundColor: "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(6px)",
                border: "1px solid #dce8db",
                color: "#0c5327",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
                zIndex: 14,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.9)")}
            >
              <ChevronLeft size={20} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              title="Next media"
              aria-label="Next slide"
              style={{
                position: "absolute",
                top: "50%",
                right: "12px",
                transform: "translateY(-50%)",
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                backgroundColor: "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(6px)",
                border: "1px solid #dce8db",
                color: "#0c5327",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
                zIndex: 14,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.9)")}
            >
              <ChevronRight size={20} />
            </button>

            {/* Auto-Slide Progress Dots & Pause Toggle */}
            <div
              style={{
                position: "absolute",
                bottom: "12px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 8px",
                backgroundColor: "rgba(12, 83, 39, 0.75)",
                backdropFilter: "blur(4px)",
                borderRadius: "20px",
                zIndex: 14,
              }}
            >
              {/* Auto-slide pause/play toggle */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsAutoPlaying((prev) => !prev);
                }}
                title={isAutoPlaying ? "Pause automatic media slider" : "Resume automatic media slider"}
                aria-label={isAutoPlaying ? "Pause slider" : "Play slider"}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "2px 4px",
                  marginRight: "4px",
                  borderRadius: "4px",
                }}
              >
                {isAutoPlaying && !isHovered ? <Pause size={11} /> : <Play size={11} />}
              </button>

              {mediaSequence.map((item, idx) => {
                const isActive = idx === currentIndex;
                return (
                  <button
                    key={item.id || idx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToIndex(idx);
                    }}
                    title={item.type === "video" ? "Promotional Video" : `Slide ${idx + 1}`}
                    aria-label={`Go to slide ${idx + 1}`}
                    style={{
                      border: "none",
                      width: isActive ? "18px" : "7px",
                      height: "7px",
                      borderRadius: "4px",
                      backgroundColor: isActive ? "#ffffff" : "rgba(255, 255, 255, 0.4)",
                      cursor: "pointer",
                      padding: 0,
                      transition: "all 0.25s ease",
                    }}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Thumbnails Strip (Feature B & C Synchronization) */}
      {mediaSequence.length > 1 && (
        <div
          className="gv-details-thumbnails-strip"
          role="tablist"
          aria-label="Product media thumbnails"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginTop: "14px",
            overflowX: "auto",
            padding: "4px 2px 8px",
            scrollbarWidth: "thin",
          }}
        >
          {mediaSequence.map((item, idx) => {
            const isActive = idx === currentIndex;

            if (item.type === "video") {
              return (
                <button
                  key={item.id || "video-thumb"}
                  type="button"
                  className={`gv-details-thumbnail-btn gv-details-video-thumb-btn ${
                    isActive ? "is-active" : ""
                  }`}
                  onClick={() => goToIndex(idx)}
                  aria-label="Watch promotional video"
                  aria-selected={isActive}
                  title={item.title || "Watch promotional video"}
                  style={{
                    position: "relative",
                    width: "76px",
                    height: "76px",
                    flexShrink: 0,
                    borderRadius: "12px",
                    border: isActive ? "2px solid #0c5327" : "2px solid #c9e4c5",
                    backgroundColor: "#eaf5e8",
                    color: "#0c5327",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: isActive ? "0 0 0 2px rgba(12, 83, 39, 0.25)" : "none",
                    transform: isActive ? "scale(1.02)" : "none",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "4px",
                      fontSize: "11px",
                      fontWeight: "700",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    <Play size={18} fill="currentColor" />
                    <span>Video</span>
                  </div>
                </button>
              );
            }

            const thumbUrl = resolveImageUrl(item.url);
            return (
              <button
                key={item.id || `thumb-${idx}`}
                type="button"
                className={`gv-details-thumbnail-btn ${isActive ? "is-active" : ""}`}
                onClick={() => goToIndex(idx)}
                aria-label={`View photo ${idx + 1} ${item.isPrimary ? "(Primary)" : ""}`}
                aria-selected={isActive}
                style={{
                  width: "76px",
                  height: "76px",
                  flexShrink: 0,
                  borderRadius: "12px",
                  border: isActive ? "2px solid #0c5327" : "2px solid #e1ebe0",
                  backgroundColor: "#f7faf5",
                  padding: 0,
                  overflow: "hidden",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: isActive ? "0 0 0 2px rgba(12, 83, 39, 0.25)" : "none",
                  transform: isActive ? "scale(1.02)" : "none",
                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <img
                  src={thumbUrl}
                  alt={`${productName} thumbnail ${idx + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
