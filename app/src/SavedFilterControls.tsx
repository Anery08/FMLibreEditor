// The saved filters, in the head of the player and the staff filter bar: Save, which asks for a name there and then (no
// dialog), and the select that brings a saved filter back, with Delete for the one that is in effect.

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { playerListText } from "./labels";
import {
  cleanName,
  isInEffect,
  MAX_NAME_LENGTH,
  MAX_SAVED,
  useSavedFilters,
  type SavedFilterKind,
} from "./savedFilters";
import type { ColumnOrder } from "./SortHeader";

const text = playerListText.filters.saved;

/**
 * What the name form asks, with the name as typed so far. "name": for a name. "replace": whether the saved filter that
 * has this name is to be replaced. "full": for another name, as this one is new and no more filters can be saved.
 */
interface Form {
  name: string;
  stage: "name" | "replace" | "full";
}

interface SavedFilterControlsProps<Fields, Order> {
  /** The list whose saved filters these are (see `PLAYER_FILTERS` and `STAFF_FILTERS`). */
  kind: SavedFilterKind<Fields, Order>;
  /** What the filter bar holds and how the list is sorted: what Save keeps, and what a saved filter is compared to. */
  fields: Fields;
  order: Order | null;
  /** Whether any filter is in effect: with none there is nothing to save. */
  filtered: boolean;
  /** Makes a saved filter the one in effect: its fields go to the filter bar and its sort to the list. */
  onApply: (fields: Fields, order: Order | null) => void;
}

/** Save, and the select of the saved filters with Delete; they sit after Clear in the head of the filter bar. */
export function SavedFilterControls<Fields extends object, Order extends ColumnOrder<string>>({
  kind,
  fields,
  order,
  filtered,
  onApply,
}: SavedFilterControlsProps<Fields, Order>) {
  const { saved, has, save, remove } = useSavedFilters(kind);
  // The saved filter that was applied or saved last. It is the one in effect for as long as the bar and the sort are
  // as it has them: the select shows it, and Delete is for it.
  const [chosen, setChosen] = useState<string | null>(null);
  const [asked, setAsked] = useState<Form | null>(null);
  const questionId = useId();
  const saveButton = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const wasAsking = useRef(false);

  // The form goes with the filters: Save is gone while none is in effect, so is what it asked.
  const form = filtered ? asked : null;
  const current = saved.find((entry) => entry.name === chosen && isInEffect(kind, entry, fields, order));
  const typing = form !== null && form.stage !== "replace";
  const replacing = form?.stage === "replace";
  const closed = form === null;

  useEffect(() => {
    if (!filtered) {
      setAsked(null);
    }
  }, [filtered]);

  // The name input takes focus when the form opens or comes back from the question, with its text selected.
  useEffect(() => {
    if (typing) {
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [typing]);

  // The question puts focus on its safe answer, as the question of the edit footer does.
  useEffect(() => {
    if (replacing) {
      cancelButton.current?.focus();
    }
  }, [replacing]);

  // The form and its buttons are gone: focus goes back to Save, from which it was opened.
  useEffect(() => {
    if (wasAsking.current && closed) {
      saveButton.current?.focus();
    }
    wasAsking.current = !closed;
  }, [closed]);

  const begin = () => setAsked({ name: chosen ?? "", stage: "name" });

  /** Keeps the filters in effect under `name`; a new name when no more can be kept is told so. */
  const keep = (name: string) => {
    if (save(name, fields, order)) {
      setChosen(name);
      setAsked(null);
    } else {
      setAsked({ name, stage: "full" });
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = cleanName(form?.name ?? "");
    if (name === "") {
      return;
    }
    if (has(name)) {
      setAsked({ name, stage: "replace" });
    } else {
      keep(name);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) {
      return;
    }
    // Escape is answered here and goes no further: the profile beside the list, which closes on Escape too, stays open.
    event.stopPropagation();
    setAsked(form?.stage === "replace" ? { name: form.name, stage: "name" } : null);
  };

  const apply = (name: string) => {
    const entry = saved.find((other) => other.name === name);
    if (entry) {
      setChosen(entry.name);
      onApply({ ...entry.fields }, entry.order && { ...entry.order });
    }
  };

  const del = (name: string) => {
    // Focus goes first to what stays: the select, or with nothing saved any more the button that opens the filters.
    if (saved.length > 1) {
      select.current?.focus();
    } else {
      select.current?.closest(".filter-head")?.querySelector<HTMLElement>(".filter-toggle")?.focus();
    }
    remove(name);
    setChosen(null);
  };

  return (
    <>
      {form === null ? (
        filtered && (
          <button ref={saveButton} type="button" className="filter-save" title={text.saveTitle} onClick={begin}>
            {text.save}
          </button>
        )
      ) : form.stage === "replace" ? (
        <div className="saved-ask" role="group" aria-labelledby={questionId} onKeyDown={onKeyDown}>
          <span id={questionId}>{text.replaceQuestion(form.name)}</span>
          <button
            ref={cancelButton}
            type="button"
            onClick={() => setAsked({ name: form.name, stage: "name" })}
          >
            {text.cancel}
          </button>
          <button type="button" className="danger" onClick={() => keep(form.name)}>
            {text.replace}
          </button>
        </div>
      ) : (
        <form className="saved-form" onSubmit={submit} onKeyDown={onKeyDown}>
          <input
            ref={nameInput}
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_NAME_LENGTH}
            placeholder={text.namePlaceholder}
            aria-label={text.name}
            value={form.name}
            onChange={(e) => setAsked({ name: e.currentTarget.value, stage: "name" })}
          />
          <button type="submit" disabled={cleanName(form.name) === ""}>
            {text.ok}
          </button>
          <button type="button" onClick={() => setAsked(null)}>
            {text.cancel}
          </button>
          {form.stage === "full" && (
            <span className="saved-note" role="alert">
              {text.full(MAX_SAVED)}
            </span>
          )}
        </form>
      )}

      {saved.length > 0 && (
        <span className="saved-pick">
          <select
            ref={select}
            className="saved-select"
            aria-label={text.select}
            value={current?.name ?? ""}
            onChange={(e) => apply(e.currentTarget.value)}
          >
            <option value="" disabled>
              {text.select}
            </option>
            {saved.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
          {current && (
            <button
              type="button"
              className="saved-delete"
              aria-label={text.deleteTitle(current.name)}
              title={text.deleteTitle(current.name)}
              onClick={() => del(current.name)}
            >
              {text.delete}
            </button>
          )}
        </span>
      )}
    </>
  );
}
