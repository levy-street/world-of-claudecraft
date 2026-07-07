import type { TranslationKey, t as translate } from './i18n';

type Translate = typeof translate;
type NumberFormatter = typeof import('./i18n').formatNumber;

const PET_COOLDOWN_FRACTION_DIGITS = 1;
const PET_COOLDOWN_MIN_VISIBLE = 0.1;
const PERCENT_SCALE = 100;

export interface PetActionButtonLabelInput {
  actionLabel: string;
  cooldownText?: string;
  autoBadge?: string;
  t: Translate;
}

export interface PetActionButtonLabels {
  title: string;
  ariaLabel: string;
  autoBadge?: string;
}

export function formatPetCooldownShort(
  remaining: number,
  formatNumber: NumberFormatter,
  secondsUnit: string,
): string | undefined {
  if (remaining <= 0) return undefined;
  const value =
    remaining >= 1 ? Math.ceil(remaining) : Math.max(PET_COOLDOWN_MIN_VISIBLE, remaining);
  const seconds = formatNumber(value, {
    minimumFractionDigits: remaining >= 1 ? 0 : PET_COOLDOWN_FRACTION_DIGITS,
    maximumFractionDigits: remaining >= 1 ? 0 : PET_COOLDOWN_FRACTION_DIGITS,
    useGrouping: false,
  });
  return `${seconds}${secondsUnit}`;
}

export function petCooldownProgress(remaining: number, total: number): number {
  if (remaining <= 0 || total <= 0) return 0;
  return Math.max(0, Math.min(PERCENT_SCALE, (remaining / total) * PERCENT_SCALE));
}

export function petActionButtonLabels(input: PetActionButtonLabelInput): PetActionButtonLabels {
  const autoBadge = input.autoBadge;
  const cooldownText = input.cooldownText;
  if (cooldownText) {
    const title = input.t('hudChrome.petAction.cooldownTitle', {
      action: input.actionLabel,
      seconds: cooldownText,
    });
    return {
      title,
      ariaLabel: autoBadge
        ? input.t('hudChrome.petAction.cooldownAutoAria', {
            action: input.actionLabel,
            seconds: cooldownText,
            auto: autoBadge,
          })
        : title,
      autoBadge,
    };
  }
  if (autoBadge) {
    const label = input.t('hudChrome.petAction.autoAria', {
      action: input.actionLabel,
      auto: autoBadge,
    });
    return { title: label, ariaLabel: label, autoBadge };
  }
  return { title: input.actionLabel, ariaLabel: input.actionLabel };
}

export const PET_ACTION_FEEDBACK_KEYS = [
  'hudChrome.petAction.cooldownTitle',
  'hudChrome.petAction.cooldownAutoAria',
  'hudChrome.petAction.autoAria',
] as const satisfies readonly TranslationKey[];
