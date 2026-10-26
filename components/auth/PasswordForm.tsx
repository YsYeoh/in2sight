'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { passwordStrength, type PasswordFormState } from '@/lib/auth/password-rules';

const LEVELS = ['weak', 'fair', 'good', 'strong', 'veryStrong'] as const;
const EMPTY = { current: '', password: '', confirm: '' };

/**
 * New password + confirm with a strength meter; `withCurrent` adds the current-password field (Settings → Security).
 * Used by Settings (change) and /login/reset (after a recovery link). The server decides; the meter only guides.
 */
export function PasswordForm({
  action,
  email,
  withCurrent,
  submitLabel,
}: {
  action: (prev: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;
  email: string | null;
  withCurrent: boolean;
  submitLabel: string;
}) {
  const t = useTranslations('auth.password');
  const ts = useTranslations('auth.security');
  // controlled: React resets uncontrolled fields after every action, which would wipe them after a wrong current password
  const [values, setValues] = useState(EMPTY);
  const [state, formAction, pending] = useActionState(async (prev: PasswordFormState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) setValues(EMPTY); // typed passwords never outlive a successful change
    return result;
  }, {});
  const strength = passwordStrength(values.password, email);
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const fieldError = (key: 'wrong_password' | 'weak' | 'mismatch') => (state.error === key ? t(`errors.${key}`) : undefined);
  const formError = state.error && !['wrong_password', 'weak', 'mismatch'].includes(state.error) ? t(`errors.${state.error}`) : null;

  return (
    <form action={formAction} className="flex flex-col gap-[var(--gp)]" noValidate>
      {/* lets password managers file the new password under the right account */}
      <input type="text" name="username" autoComplete="username" value={email ?? ''} readOnly hidden />
      {withCurrent ? (
        <FormField id="current-password" label={t('current')} error={fieldError('wrong_password')}>
          {(p) => <PasswordInput {...p} name="current" autoComplete="current-password" value={values.current} onChange={set('current')} />}
        </FormField>
      ) : null}
      <FormField id="new-password" label={t('new')} hint={t('rules')} error={fieldError('weak')}>
        {(p) => <PasswordInput {...p} name="password" autoComplete="new-password" value={values.password} onChange={set('password')} />}
      </FormField>
      {values.password ? (
        <div className="flex flex-col gap-1.5" data-testid="password-meter">
          <div className="grid grid-cols-4 gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={i <= strength.score ? 'h-1 rounded-full bg-primary' : 'h-1 rounded-full bg-muted'} />
            ))}
          </div>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {t('strength', { level: t(`levels.${LEVELS[strength.score]}`) })}
            {strength.issue ? ` ${t(`issues.${strength.issue}`)}` : ''}
          </p>
        </div>
      ) : null}
      <FormField id="confirm-password" label={t('confirm')} error={fieldError('mismatch')}>
        {(p) => <PasswordInput {...p} name="confirm" autoComplete="new-password" value={values.confirm} onChange={set('confirm')} />}
      </FormField>
      {formError ? (
        <p role="alert" className="text-xs text-destructive">
          {formError}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.othersSignedOut === false ? ts('passwordChangedOthersFailed') : ts('passwordChanged')}
        </p>
      ) : null}
      <LoadingButton type="submit" pending={pending} className="self-start">
        {submitLabel}
      </LoadingButton>
    </form>
  );
}
