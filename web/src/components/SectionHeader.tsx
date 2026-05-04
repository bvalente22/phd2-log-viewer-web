/**
 * Collapsible disclosure that renders the raw header lines captured by the
 * parser for the active guiding or calibration section. Mirrors what the
 * desktop's left-pane "Notes" panel shows for the selected section — equipment
 * profile, pixel scale, mount/algorithm settings, target coords, etc.
 *
 * Default-collapsed because the block is wider than it is tall (12-16 short
 * lines per section) and would otherwise eat vertical space we want for the
 * chart. The summary line offers a single-glance peek at the most useful
 * field (equipment profile) and the line count.
 */
export function SectionHeader({ hdr, kind }: { hdr: string[]; kind: 'GUIDING' | 'CALIBRATION' }) {
  if (!hdr || hdr.length === 0) return null;
  // Pull the equipment-profile line for the collapsed peek; fall back to the
  // first line if absent (some logs don't emit it).
  const profileLine = hdr.find((l) => l.startsWith('Equipment Profile = ')) ?? hdr[0];
  const peek = profileLine.length > 80 ? profileLine.slice(0, 80) + '…' : profileLine;
  const label = kind === 'GUIDING' ? 'Guiding header' : 'Calibration header';

  return (
    <details
      className="group border-b border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-300"
      title="Click to expand the full header captured by PHD2 for this section (equipment, mount, algorithms, target coords)"
    >
      <summary className="cursor-pointer select-none list-none marker:hidden">
        {/* Caret rotates 90° when the details element is open (Tailwind's
            open: variant on the parent group). */}
        <span className="mr-2 inline-block w-3 text-slate-500 transition-transform group-open:rotate-90">▸</span>
        <span className="font-medium text-slate-200">{label}</span>
        <span className="mx-2 text-slate-600">·</span>
        <span className="text-slate-400">{hdr.length} lines</span>
        <span className="mx-2 text-slate-600">·</span>
        <span className="text-slate-500" title={profileLine}>{peek}</span>
      </summary>
      {/* Wrap so wide lines (mount string, RA/Dec/HourAngle) don't force a
          horizontal scroll. Monospace makes the key=value pairs line up. */}
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-slate-300">
        {hdr.join('\n')}
      </pre>
    </details>
  );
}
