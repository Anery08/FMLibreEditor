// What makes a dialog modal: Tab and focus stay inside it, and Escape closes it without anything behind it hearing it.

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** The elements of `box` that Tab stops at, in order. */
function tabbable(box: HTMLElement): HTMLElement[] {
  const found = box.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, summary, [tabindex]");
  return Array.from(found).filter(
    (el) => el.tabIndex >= 0 && !el.matches(":disabled") && el.getClientRects().length > 0,
  );
}

/** Tab from the last element of `box` goes to the first, and Shift+Tab from the first to the last. */
function keepTabInside(event: KeyboardEvent, box: HTMLElement): void {
  const items = tabbable(box);
  if (items.length === 0) {
    event.preventDefault();
    box.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (active === null || !box.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && (active === first || active === box)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Makes `box` a modal dialog while it is mounted: Tab and focus stay inside it, and Escape closes it when `canClose`
 * (and does nothing while a call runs). Escape is answered here and goes no further, so the profile behind the dialog,
 * which closes on Escape too, stays open. While a note of the dialog shows (see `InfoTip`), Escape is the note's: it
 * hides that, and stops the key itself.
 */
export function useModal(box: RefObject<HTMLElement | null>, canClose: boolean, onClose: () => void): void {
  // Kept up to date as soon as a render is on screen, so that a key pressed right after (say) Preview was pressed
  // already finds the dialog busy.
  const latest = useRef({ canClose, onClose });
  useLayoutEffect(() => {
    latest.current = { canClose, onClose };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = box.current;
      if (!dialog || event.isComposing) {
        return;
      }
      if (event.key === "Escape") {
        if (dialog.querySelector("[data-open-tip]")) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        if (latest.current.canClose) {
          latest.current.onClose();
        }
      } else if (event.key === "Tab") {
        keepTabInside(event, dialog);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const dialog = box.current;
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        (tabbable(dialog)[0] ?? dialog).focus();
      }
    };
    // The window's capture phase comes before anything else: no other handler sees the keys while the dialog is up.
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [box]);
}
