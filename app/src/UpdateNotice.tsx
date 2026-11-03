import { useState } from "react";
import { updateText } from "./labels";
import { installUpdate, NothingToInstall, openRelease, type InstallProgress, type Release, type UpdateState } from "./update";
import { askToLeave } from "./useProfileEditing";

const text = updateText;

/** How far installing has got, in the notice's words. */
function progressText(progress: InstallProgress): string {
  switch (progress.phase) {
    case "preparing":
      return text.preparing;
    case "downloading":
      return text.downloading(progress.percent);
    case "installing":
      return text.installing;
  }
}

interface UpdateNoticeProps {
  release: Release;
  current: string | null;
  /** Whether this copy can update itself: Update then installs the new version, else Download opens its page. */
  selfUpdate: boolean;
  onLater: (release: Release) => void;
}

/**
 * The notice under the masthead that a newer version is out. Update downloads and installs it, saying how far it has
 * got, and the app closes and opens again with it; where the app cannot do that, or it failed, Download opens the
 * release's page in the browser. Later puts the notice aside.
 */
export function UpdateNotice({ release, current, selfUpdate, onLater }: UpdateNoticeProps) {
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  const install = async () => {
    setError(null);
    try {
      await installUpdate(setProgress);
    } catch (e) {
      setProgress(null);
      setError(e instanceof NothingToInstall ? text.notInstallable : text.installFailed(String(e)));
    }
  };

  return (
    <div className="update-notice" role="status">
      <span>
        <strong>{text.available(release.version)}</strong>
        {current && <span className="update-current">{text.youHave(current)}</span>}
        {progress && <span className="update-progress">{progressText(progress)}</span>}
        {error && <span className="update-error">{error}</span>}
      </span>
      <span className="update-actions">
        {selfUpdate && error === null ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            title={text.installTitle}
            // Edits pending in the open profile would be lost when the app closes: it asks first.
            onClick={() => askToLeave(() => void install())}
          >
            {text.install}
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => openRelease(release)}>
            {text.download}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => onLater(release)}>
          {text.later}
        </button>
      </span>
    </div>
  );
}

/** What a check by hand found, in the words of the foot of the window. */
function answer(state: UpdateState): string {
  switch (state.phase) {
    case "checking":
      return text.checking;
    case "current":
      return text.upToDate;
    case "failed":
      return text.failed;
    case "newer":
      return text.available(state.release.version);
  }
}

/**
 * Check for updates, at the foot of the window beside the app's version; once pressed, what it found takes its place
 * until the answer comes. Only the answer to a press is shown there: the check at startup speaks through the notice.
 */
export function UpdateCheck(props: { state: UpdateState; asked: boolean; onCheck: () => void }) {
  const { state, asked, onCheck } = props;
  return (
    <span className="update-check">
      {asked && <span className="update-answer">{answer(state)}</span>}
      {!(asked && state.phase === "checking") && (
        <button type="button" className="update-link" onClick={onCheck}>
          {text.check}
        </button>
      )}
    </span>
  );
}
