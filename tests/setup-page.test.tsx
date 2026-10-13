import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

vi.mock('next-intl/server', () => ({ getTranslations: async (ns: string) => (k: string) => (en as never as Record<string, Record<string, string>>)[ns][k] }));

import SetupPage from '@/app/setup/page';

describe('/setup', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('names the variables to set, points to the guide, and never prints a value', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_must_not_appear');
    render(await SetupPage());
    for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_APP_URL']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText(/docs\/SETUP\.md/)).toBeInTheDocument();
    expect(screen.getByText('npm run check:env')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sb_secret_must_not_appear');
  });
});
