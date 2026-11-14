export function Avatar({
  label,
  mine = false,
}: {
  label: string;
  mine?: boolean;
}) {
  return <div className={`avatar ${mine ? "mine" : ""}`.trim()}>{label}</div>;
}
