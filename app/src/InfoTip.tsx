// A note behind a small (i) button, for what most people need not read. It shows while the pointer is over the button
// or the note, while the button has keyboard focus, and after a click on it until the next click anywhere. Escape
// hides it, and only it (see `useModal`), until the pointer and focus have left. The note describes the button
// (aria-describedby), so assistive technology reads it with the button.
//
// The note is placed under the element the button sits in, as wide as it: that element must be positioned.

import { useEffect, useId, useRef, useState } from "react";

/** How long the note stays once the pointer has left, so that the pointer can cross over to it. */
const HIDE_DELAY = 150;

interface InfoTipProps {
  /** The button's name for assistive technology, e.g. "Why?". */
  label: string;
  note: string;
}

export function InfoTip({ label, note }: InfoTipProps) {
  const noteId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = !dismissed && (hovered || focused || pinned);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // What Escape hid may show again once the pointer and focus have both left (at once, when it only showed from a
  // click).
  useEffect(() => {
    if (dismissed && !hovered && !focused) {
      setDismissed(false);
    }
  }, [dismissed, hovered, focused]);

  // While it shows, a click elsewhere takes back a click that opened it, and Escape hides it. The dialog lets this
  // Escape through, and it goes no further than here: the profile behind the dialog, which closes on Escape, stays.
  useEffect(() => {
    if (!shown) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) {
        setPinned(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.stopPropagation();
        event.preventDefault();
        setPinned(false);
        setDismissed(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shown]);

  const enter = () => {
    window.clearTimeout(hideTimer.current);
    setHovered(true);
  };
  const leave = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHovered(false), HIDE_DELAY);
  };

  return (
    <span ref={box} className="info-tip" data-open-tip={shown || undefined} onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-describedby={noteId}
        onClick={() => {
          setPinned((open) => !open);
          setDismissed(false);
        }}
        // A click focuses the button in some browsers: only focus from the keyboard shows the note by itself.
        onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocused(false)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v4.5M10 6.3v0.01" />
        </svg>
      </button>
      <span id={noteId} role="tooltip" className={shown ? "info-tip-note shown" : "info-tip-note"}>
        {note}
      </span>
    </span>
  );
}
