// The menu at the end of a row of the squad table: Make captain and Make vice-captain for the player of that row. The
// table scrolls in a box of its own, which would cut a menu off at its edge, so the menu is drawn over the window, at
// the place of its button, instead.

import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { squadText as text } from "./labels";
import type { CaptainRole } from "./types";
import { EditorContext } from "./useProfileEditing";

/** The room the menu keeps between itself and its button, and between itself and the edge of the window. */
const GAP = 4;

/** Where the open menu hangs: the window's coordinates of its button, from the right edge and the top. */
interface Anchor {
  right: number;
  top: number;
  bottom: number;
}

interface CaptainMenuProps {
  /** The player's name, which names the button. */
  name: string;
  /** The role he holds, which the menu does not offer again. */
  holds: CaptainRole | null;
  /** Whether the game can be written to: without it the button is dimmed, and says why. */
  editable: boolean;
  /** Whether a change is under way: the menu waits for it. */
  busy: boolean;
  onPick: (role: CaptainRole) => void;
}

/** The button of a row and, once it is pressed, its menu. */
export function CaptainMenu({ name, holds, editable, busy, onPick }: CaptainMenuProps) {
  const { readOnlyNote } = useContext(EditorContext);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = anchor !== null;

  const show = () => {
    const box = button.current?.getBoundingClientRect();
    if (box) {
      setAnchor({ right: document.documentElement.clientWidth - box.right, top: box.top, bottom: box.bottom });
    }
  };

  // Once the menu is on screen it moves above its button if it would run off the bottom of the window, and takes focus.
  useLayoutEffect(() => {
    const list = menu.current;
    if (anchor === null || list === null) {
      return;
    }
    const { height } = list.getBoundingClientRect();
    if (anchor.bottom + GAP + height > window.innerHeight - GAP) {
      list.style.top = `${Math.max(GAP, anchor.top - GAP - height)}px`;
    }
    list.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor]);

  // A press elsewhere closes it, and so does a scroll or a resize: the button moves with the table, the menu does not.
  useEffect(() => {
    if (!open) {
      return;
    }
    const pressed = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && (menu.current?.contains(target) || button.current?.contains(target))) {
        return;
      }
      setAnchor(null);
    };
    const close = () => setAnchor(null);
    document.addEventListener("pointerdown", pressed, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const pick = (role: CaptainRole) => {
    setAnchor(null);
    button.current?.focus();
    onPick(role);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const at = items.findIndex((item) => item === document.activeElement);
    let next: HTMLElement | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = items[(at + 1) % items.length];
        break;
      case "ArrowUp":
        next = items[(at - 1 + items.length) % items.length];
        break;
      case "Home":
        next = items[0];
        break;
      case "End":
        next = items[items.length - 1];
        break;
      case "Escape":
        // The profile behind closes on Escape too: this one is the menu's.
        event.stopPropagation();
        event.preventDefault();
        setAnchor(null);
        button.current?.focus();
        return;
      case "Tab":
        // Tab leaves the menu for the controls after its button.
        setAnchor(null);
        button.current?.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button squad-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={text.menuLabel(name)}
        // While a change is under way the button is only dimmed (aria-disabled): a disabled button loses focus.
        aria-disabled={busy || undefined}
        disabled={!editable}
        title={editable ? text.menuTitle : readOnlyNote}
        onClick={() => {
          if (open) {
            setAnchor(null);
          } else if (!busy) {
            show();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open && !busy) {
            event.preventDefault();
            show();
          }
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 10h.01M10 10h.01M16 10h.01" />
        </svg>
      </button>
      {anchor !== null &&
        createPortal(
          <div
            ref={menu}
            className="squad-menu"
            role="menu"
            aria-label={text.menuLabel(name)}
            style={{ top: anchor.bottom + GAP, right: anchor.right }}
            onKeyDown={keyDown}
          >
            {holds !== "captain" && (
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick("captain")}>
                {text.makeCaptain}
              </button>
            )}
            {holds !== "viceCaptain" && (
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick("viceCaptain")}>
                {text.makeViceCaptain}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
