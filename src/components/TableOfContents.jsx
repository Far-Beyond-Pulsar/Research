'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import slugify from 'slugify';

const COOKIE_KEY = 'toc-width';
const MIN_WIDTH = 140;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 200;

function readWidthCookie() {
  if (typeof document === 'undefined') return DEFAULT_WIDTH;
  const match = document.cookie.match(/(?:^|;\s*)toc-width=(\d+)/);
  if (!match) return DEFAULT_WIDTH;
  const v = parseInt(match[1], 10);
  return Number.isFinite(v) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v)) : DEFAULT_WIDTH;
}

function saveWidthCookie(w) {
  document.cookie = `${COOKIE_KEY}=${w}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

function slugFrom(text) {
  return slugify(String(text), { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
}

function extractHeadings(markdown) {
  const headings = [];
  const lines = markdown.split('\n');
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith('```') || line.startsWith('~~~')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/\*\*|__|\*|_|`/g, '').trim();
      headings.push({ level, text, id: slugFrom(text) });
    }
  }
  return headings;
}

export default function TableOfContents({ markdown }) {
  const [activeId, setActiveId] = useState('');
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const headings = extractHeadings(markdown);
  const observerRef = useRef(null);
  const navRef = useRef(null);
  const activeItemRef = useRef(null);
  const dragRef = useRef(null); // { startX, startWidth }

  // Restore width from cookie on mount
  useEffect(() => { setWidth(readWidthCookie()); }, []);

  // Resize drag handling
  const onHandleMouseDown = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: width };

    const onMove = (ev) => {
      const delta = dragRef.current.startX - ev.clientX; // dragging left = wider
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta));
      setWidth(next);
    };

    const onUp = (ev) => {
      const delta = dragRef.current.startX - ev.clientX;
      const final = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta));
      saveWidthCookie(final);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  // IntersectionObserver for active heading
  useEffect(() => {
    if (headings.length === 0) return;
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-72px 0px -55% 0px', threshold: 0 }
    );
    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, [markdown]);

  // Auto-scroll TOC to active item
  useEffect(() => {
    if (!activeItemRef.current || !navRef.current) return;
    const nav = navRef.current;
    const item = activeItemRef.current;
    const navTop = nav.scrollTop;
    const navBottom = navTop + nav.clientHeight;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < navTop + 32) {
      nav.scrollTo({ top: itemTop - 32, behavior: 'smooth' });
    } else if (itemBottom > navBottom - 32) {
      nav.scrollTo({ top: itemBottom - nav.clientHeight + 32, behavior: 'smooth' });
    }
  }, [activeId]);

  if (headings.length < 2) return null;

  return (
    <nav
      ref={navRef}
      className="toc"
      style={{ width }}
      aria-label="Table of contents"
    >
      {/* Drag handle on the left edge */}
      <div className="toc-resize-handle" onMouseDown={onHandleMouseDown} aria-hidden="true" />

      <p className="toc-label">On this page</p>
      <ul className="toc-list">
        {headings.map(({ level, text, id }) => {
          const isActive = activeId === id;
          return (
            <li
              key={id}
              ref={isActive ? activeItemRef : null}
              className={`toc-item toc-h${level}${isActive ? ' toc-active' : ''}`}
            >
              <a
                href={`#${id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  setActiveId(id);
                }}
              >
                {text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
