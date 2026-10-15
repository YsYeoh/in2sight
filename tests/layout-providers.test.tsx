import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');

describe('root layout providers', () => {
  it('mounts TooltipProvider inside PrefsProvider', () => {
    expect(layout).toContain('<PrefsProvider');
    expect(layout).toContain('<TooltipProvider');
    expect(layout.indexOf('<TooltipProvider')).toBeGreaterThan(layout.indexOf('<PrefsProvider'));
  });

  it('mounts the navigation progress bar inside PrefsProvider, in its own Suspense boundary', () => {
    expect(layout).toMatch(/<Suspense fallback=\{null\}>\s*<NavigationProgress \/>\s*<\/Suspense>/);
    expect(layout.indexOf('<NavigationProgress')).toBeGreaterThan(layout.indexOf('<PrefsProvider'));
  });

  it('a Tooltip shows its content on hover inside TooltipProvider', async () => {
    // jsdom has no ResizeObserver; Radix Popper needs one.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Helpful text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByText('Info'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Helpful text');
  });
});
