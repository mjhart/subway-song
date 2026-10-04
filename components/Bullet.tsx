import { DARK_TEXT_ROUTES, ROUTE_COLORS } from '@/lib/subway';

/** A subway line's colored roundel. */
export default function Bullet({ label }: { label: string }) {
  return (
    <span
      className="bullet"
      style={{ background: ROUTE_COLORS[label], color: DARK_TEXT_ROUTES.has(label) ? '#000' : undefined }}
    >
      {label === 'SIR' ? 'SI' : label}
    </span>
  );
}
