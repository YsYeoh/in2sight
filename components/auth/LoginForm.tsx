'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Input } from '@/components/ui/input';
import type { FormState } from '@/lib/auth/sign-in';

export function LoginForm({ action }: { action: (prev: FormState, formData: FormData) => Promise<FormState> }) {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className="flex flex-col gap-[var(--gp)]" noValidate>
      <FormField id="email" label={t('login.email')}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="username" />}
      </FormField>
      <FormField id="password" label={t('login.password')}>
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" />}
      </FormField>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <LoadingButton type="submit" pending={pending} className="w-full">
        {pending ? t('login.submitting') : t('login.submit')}
      </LoadingButton>
    </form>
  );
}
