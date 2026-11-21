import { isChunkLoadError } from "../utils/chunkLoadError.js";

// Shown in place of a single page that failed, inside the app shell, so the
// sidebar and top bar stay usable.
export default function PageErrorFallback({ error, reset }) {
  const reload = () => window.location.reload();

  if (isChunkLoadError(error)) {
    return (
      <div className="page-error" role="alert">
        <h2 className="page-error-title">A new version is available</h2>
        <p className="page-error-copy">
          LicenseTrack was updated while this tab was open, so this page could
          not be loaded. Reload to continue with the new version.
        </p>
        <div className="page-error-actions">
          <button type="button" className="btn btn-p" onClick={reload}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-error" role="alert">
      <h2 className="page-error-title">This page could not be displayed</h2>
      <p className="page-error-copy">
        An unexpected error occurred on this page. The rest of LicenseTrack
        still works: try again, or open another page from the navigation.
      </p>
      <div className="page-error-actions">
        <button type="button" className="btn btn-p" onClick={reset}>
          Try again
        </button>
        <button type="button" className="btn btn-g" onClick={reload}>
          Reload page
        </button>
      </div>
    </div>
  );
}
