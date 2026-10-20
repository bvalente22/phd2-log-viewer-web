import { useTranslation } from 'react-i18next';
import { fmtNumber, wrapTip } from '../i18n/format';
import { useLogBundleStore } from '../state/logBundleStore';
import { useLogStore } from '../state/logStore';
import { DebugBadge } from './DebugBadge';

/** "0.7 MB" / "84 kB" — guide logs are tens of kB to a few MB. */
const fmtSize = (bytes: number): string =>
  bytes >= 100_000 ? `${fmtNumber(bytes / 1_000_000, 1)} MB` : `${fmtNumber(bytes / 1_000, 0)} kB`;

/**
 * "Logs in <zip>" list under the drop zone: every guide log from the last drop
 * when it held more than one (a multi-night zip, or several loose pairs). One
 * row per log, newest first, with a "D" badge when its debug log came with it;
 * clicking a row opens that log (its debug log is paired automatically).
 * Hidden for single-log drops — there's nothing to switch between.
 */
export function BundleLogList() {
  const { t } = useTranslation('sections');
  const bundle = useLogBundleStore((s) => s.bundle);
  const busy = useLogBundleStore((s) => s.busy);
  const openLog = useLogBundleStore((s) => s.openLog);
  const dismiss = useLogBundleStore((s) => s.dismiss);
  const currentName = useLogStore((s) => s.meta?.name ?? null);
  const parsing = useLogStore((s) => s.loading);

  if (!bundle || bundle.logs.length < 2) return null;
  const count = bundle.logs.length;
  const title = bundle.label
    ? t('bundle.titleZip', { name: bundle.label, count })
    : t('bundle.titleFiles', { count });

  return (
    <div className="mt-3 rounded-md border border-slate-700">
      <div className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-1.5">
        {/* Not uppercased like other sidebar headings: the zip's filename must
            read exactly as sent (PHD2's bundle names are case-sensitive codes). */}
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400" title={title}>
          {title}
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="px-1 text-slate-500 hover:text-red-400"
          title={wrapTip(t('bundle.dismissTooltip'))}
          aria-label={t('bundle.dismissTooltip')}
        >
          ×
        </button>
      </div>
      <ul className="max-h-60 overflow-y-auto">
        {bundle.logs.map((log) => {
          const isCurrent = log.guide.name === currentName;
          const tip = [
            log.guide.name,
            log.debug ? t('bundle.rowDebug', { name: log.debug.name }) : wrapTip(t('bundle.rowNoDebug')),
          ].join('\n');
          return (
            <li key={log.guide.name} className="border-b border-slate-800 last:border-b-0">
              <button
                type="button"
                disabled={busy || parsing}
                onClick={() => void openLog(log)}
                title={tip}
                aria-current={isCurrent ? 'true' : undefined}
                // The open log gets a sky accent bar instead of a "(current)"
                // tag — the sidebar is too narrow for the tag beside date+size.
                className={`flex w-full items-center gap-2 border-s-2 py-1.5 pe-2.5 ps-2 text-start text-xs hover:bg-slate-800 disabled:cursor-wait ${
                  isCurrent ? 'border-sky-400 bg-slate-800 text-slate-100' : 'border-transparent text-slate-300'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{log.dateLabel}</span>
                <span className="shrink-0 tabular-nums text-[11px] text-slate-500">{fmtSize(log.guide.size)}</span>
                {/* Fixed-width slot so sizes line up whether or not a row has a debug log. */}
                <span className="inline-flex w-4 shrink-0 justify-center">{log.debug && <DebugBadge />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
