/**
 * useStreamingText Hook
 *
 * Provides a smooth typewriter effect for any text content.
 * Adapted from the confinaid-desktop implementation.
 * Uses requestAnimationFrame with adaptive speed — renders faster
 * when there is a large backlog, slower when caught up.
 */

import { useState, useEffect, useRef, useCallback } from "react";

interface UseStreamingTextOptions {
  /** Full content (may grow incrementally, or arrive all at once). */
  content: string;
  /** Whether the external source is still actively pushing content. */
  isStreaming: boolean;
  /** Min characters per frame when caught up (default: 1). */
  minCharsPerFrame?: number;
  /** Max characters per frame when far behind (default: 18). */
  maxCharsPerFrame?: number;
}

interface UseStreamingTextReturn {
  /** Currently displayed text — typewriter cursor position. */
  displayedText: string;
  /** True while the animation loop is still running. */
  isRendering: boolean;
  /** Jump immediately to the full content, cancelling the animation. */
  skipToEnd: () => void;
}

export function useStreamingText({
  content,
  isStreaming,
  minCharsPerFrame = 1,
  maxCharsPerFrame = 18,
}: UseStreamingTextOptions): UseStreamingTextReturn {
  const [displayedText, setDisplayedText] = useState("");
  const [isRendering, setIsRendering] = useState(false);

  const rafRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const contentRef = useRef(content);
  contentRef.current = content;

  const getCharsPerFrame = useCallback((): number => {
    const backlog = contentRef.current.length - indexRef.current;
    if (backlog <= 0) return minCharsPerFrame;
    if (backlog < 20) return minCharsPerFrame;
    if (backlog < 60)
      return Math.ceil(minCharsPerFrame + (maxCharsPerFrame - minCharsPerFrame) * 0.3);
    if (backlog < 120)
      return Math.ceil(minCharsPerFrame + (maxCharsPerFrame - minCharsPerFrame) * 0.6);
    return maxCharsPerFrame;
  }, [minCharsPerFrame, maxCharsPerFrame]);

  const animate = useCallback(() => {
    const cur = contentRef.current;
    const idx = indexRef.current;

    if (idx < cur.length) {
      const step = getCharsPerFrame();
      const next = Math.min(idx + step, cur.length);
      indexRef.current = next;
      setDisplayedText(cur.slice(0, next));
    }

    if (isStreaming || indexRef.current < contentRef.current.length) {
      rafRef.current = requestAnimationFrame(animate);
    } else {
      rafRef.current = null;
      setIsRendering(false);
    }
  }, [isStreaming, getCharsPerFrame]);

  useEffect(() => {
    if (isStreaming || indexRef.current < content.length) {
      if (!rafRef.current) {
        setIsRendering(true);
        rafRef.current = requestAnimationFrame(animate);
      }
    }
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isStreaming, content, animate]);

  // Reset when content is cleared
  useEffect(() => {
    if (content.length === 0) {
      indexRef.current = 0;
      setDisplayedText("");
      setIsRendering(false);
    }
  }, [content]);

  const skipToEnd = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    indexRef.current = contentRef.current.length;
    setDisplayedText(contentRef.current);
    setIsRendering(false);
  }, []);

  return { displayedText, isRendering, skipToEnd };
}
