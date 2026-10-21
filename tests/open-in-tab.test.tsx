import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OpenInTab } from '@/components/shared/OpenInTab';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('OpenInTab', () => {
  it('is a named target=_blank link to the same page (the frame bridge turns it into an app tab)', () => {
    render(<OpenInTab href="/accounts/a1?from=2026-09-01" label="Open @a in a new tab" />);
    const a = screen.getByRole('link', { name: 'Open @a in a new tab' });
    expect(a).toHaveAttribute('href', '/accounts/a1?from=2026-09-01');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener');
    expect(a.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('sits on the Overview account cards and next to every Post Lab link of the Posts tab', () => {
    expect(src('components/overview/OverviewView.tsx')).toMatch(/<OpenInTab href=\{`\/accounts\/\$\{c\.id\}[^>]*label=\{tTab\('openInTab', \{ name: `@\$\{c\.username\}` \}\)\} \/>/);
    expect(src('components/account/PostsTab.tsx')).toMatch(/<OpenInTab href=\{postLabHref\(accountId, p\.id\)\} label=\{tTab\('openLabInTab', \{ post: label\(p\) \}\)\} \/>/);
  });
});
