/** Sidebar sections whose screen lands in a later phase (SPEC §21). */
export function Placeholder(props: { title: string; phase: string }): React.JSX.Element {
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">{props.title}</h1>
      <p className="text-sm text-ink-muted">Lands in {props.phase}.</p>
    </div>
  );
}
