'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** How close to the end still counts as "at the bottom". */
const THRESHOLD = 64;

/**
 * Keeps a scroll container pinned to its end while content grows, but only
 * if the reader was already there. Scrolling up to read turns it off;
 * `scrollToBottom` (the "jump to latest" button) turns it back on.
 */
export function useStickToBottom<S extends HTMLElement, C extends HTMLElement>(
  /** False while there is nothing to follow (an empty chat starts at its top). */
  follow = true
) {
  const scrollRef = useRef<S>(null);
  const contentRef = useRef<C>(null);
  const stuckRef = useRef(true);
  const followRef = useRef(follow);
  followRef.current = follow;
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    stuckRef.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    // Only the reader lets go of the end. A scroll event alone does not say
    // who scrolled: the view also ends up short of the end when content grows
    // (a chart mounting, a streamed token) or shrinks (an approval card
    // collapsing clamps scrollTop). So leaving the end takes a scroll that
    // follows real scrolling input: the wheel, a finger dragging, a scroll
    // key, or the scrollbar. Taps and typing inside the messages do not count.
    let inputAt = -Infinity;
    let pointerDown = false;
    const markInput = () => {
      inputAt = performance.now();
    };
    const onPointerDown = (event: PointerEvent) => {
      // On the container itself means on its scrollbar, not on a message.
      if (event.target !== el) return;
      pointerDown = true;
      markInput();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markInput();
    };
    const onPointerUp = () => {
      if (pointerDown) markInput();
      pointerDown = false;
    };
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD;
      if (near) stuckRef.current = true;
      else if (pointerDown || performance.now() - inputAt < 1500) stuckRef.current = false;
      setAtBottom(stuckRef.current);
    };
    // Content grew or the box shrank (the keyboard opened): follow only if
    // the reader was at the end.
    const observer = new ResizeObserver(() => {
      if (stuckRef.current && followRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    observer.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', markInput, { passive: true });
    el.addEventListener('touchmove', markInput, { passive: true });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    if (followRef.current) el.scrollTop = el.scrollHeight;
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', markInput);
      el.removeEventListener('touchmove', markInput);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  return { scrollRef, contentRef, atBottom, scrollToBottom };
}
