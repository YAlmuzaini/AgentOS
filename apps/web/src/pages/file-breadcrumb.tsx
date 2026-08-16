/**
 * The path, as somewhere to click rather than something to read.
 *
 * Deep agent paths (`/goals/<uuid>/notes.md`) are long enough that the header
 * was a wrapped string with no way back except the "up one level" row.
 *
 * At the root there is no trail, so nothing is drawn. It used to render a lone
 * "/" button, which the page header then set beside the title as `Files /` — a
 * slash hanging off the end of the heading with nothing after it, reading as a
 * truncation rather than as the root of a tree.
 */
export function Breadcrumb(props: {
  path: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element | null {
  const segments = props.path.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        title="Go to the root folder"
        className="machine rounded-control px-1 py-0.5 text-xs text-link transition-colors hover:bg-sunken"
        onClick={() => props.onNavigate("/")}
      >
        /
      </button>
      {segments.map((segment, index) => {
        const target = `/${segments.slice(0, index + 1).join("/")}/`;
        const last = index === segments.length - 1;
        return (
          <span key={target} className="flex items-center gap-1">
            <button
              type="button"
              title={target}
              className={`machine rounded-control px-1 py-0.5 text-xs transition-colors hover:bg-sunken ${
                last ? "text-ink" : "text-link"
              }`}
              onClick={() => props.onNavigate(target)}
            >
              {segment}
            </button>
            {last ? null : (
              <span aria-hidden className="text-ink-faint">
                /
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
