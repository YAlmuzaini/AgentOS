/**
 * The path, as somewhere to click rather than something to read.
 *
 * Deep agent paths (`/goals/<uuid>/notes.md`) are long enough that the header
 * was a wrapped string with no way back except the "up one level" row.
 */
export function Breadcrumb(props: {
  path: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const segments = props.path.split("/").filter(Boolean);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        className="machine rounded-control px-1 py-0.5 text-xs text-link hover:bg-sunken"
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
              className={`machine rounded-control px-1 py-0.5 text-xs hover:bg-sunken ${
                last ? "text-ink" : "text-link"
              }`}
              onClick={() => props.onNavigate(target)}
            >
              {segment}
            </button>
            {last ? null : <span className="text-ink-faint">/</span>}
          </span>
        );
      })}
    </span>
  );
}
