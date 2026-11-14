export function PresenceDot({ online }: { online: boolean }) {
  return <span className={online ? "presence-dot" : "presence-dot offline"} />;
}
