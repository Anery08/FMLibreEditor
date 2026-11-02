// The notice under the masthead when the game is a version FMLibreEditor has no profile for, or some of the checks it
// makes before writing did not pass: what that leaves out, and the way to edit anyway or to look for a newer version.

import { describeGame } from "./format";
import { CHECK_NAMES, compatibilityText, updateText } from "./labels";
import type { ConnectionInfo } from "./types";

const text = compatibilityText;

/**
 * Nothing while the game is a version the editor knows and every check passed. Otherwise the version (with Edit
 * anyway, while editing it is not allowed yet, and Check for updates) and the checks that did not pass: the in-game
 * date apart, as it only takes the ages away; the others leave what they cover read-only.
 */
export function CompatibilityNotice(props: {
  connection: ConnectionInfo;
  busy: boolean;
  onAllow: () => void;
  onCheckUpdates: () => void;
}) {
  const { connection, busy, onAllow, onCheckUpdates } = props;
  const failed = connection.health.results.filter((result) => !result.passed).map((result) => result.check);
  const unknown = !connection.knownBuild;
  if (!unknown && failed.length === 0) {
    return null;
  }
  const noDate = failed.includes("gameDate");
  const locked = failed.filter((check) => check !== "gameDate").map((check) => CHECK_NAMES[check]);
  return (
    <div className="compatibility-notice" role="status">
      <div className="compatibility-text">
        <strong>{unknown ? text.unknownBuild(describeGame(connection.game)) : text.failedTitle}</strong>
        {unknown && <p>{connection.editable ? text.allowedText : text.unknownBuildText}</p>}
        {noDate && <p>{text.noDate}</p>}
        {locked.length > 0 && <p>{text.failed(text.join(locked))}</p>}
        {!unknown && <p>{text.reloadHint}</p>}
      </div>
      {unknown && (
        <span className="update-actions">
          {connection.writable && !connection.editable && (
            <button type="button" className="primary" title={text.allowTitle} disabled={busy} onClick={onAllow}>
              {text.allow}
            </button>
          )}
          <button type="button" onClick={onCheckUpdates}>
            {updateText.check}
          </button>
        </span>
      )}
    </div>
  );
}
