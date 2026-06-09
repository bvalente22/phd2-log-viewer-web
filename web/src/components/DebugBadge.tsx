import { useTranslation } from 'react-i18next';

/**
 * Small "D" chip marking a guide log that has a companion PHD2 debug log
 * available (remembered across sessions or provided this session). Purely an
 * indicator — shown in the recents list and the current-log strip.
 */
export function DebugBadge() {
  const { t } = useTranslation('common');
  return (
    <span
      title={t('debugBadge.tooltip')}
      aria-label={t('debugBadge.ariaLabel')}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-sky-500/20 text-[10px] font-bold leading-none text-sky-300 ring-1 ring-sky-500/40"
    >
      D
    </span>
  );
}
