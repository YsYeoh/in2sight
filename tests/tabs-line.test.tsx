import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function tabs(variant?: 'default' | 'line') {
  return render(
    <Tabs defaultValue="a">
      <TabsList variant={variant} aria-label="Sections">
        <TabsTrigger value="a">Overview</TabsTrigger>
        <TabsTrigger value="b">Posts</TabsTrigger>
      </TabsList>
      <TabsContent value="a">A</TabsContent>
      <TabsContent value="b">B</TabsContent>
    </Tabs>,
  );
}

describe('underline tabs (variant="line")', () => {
  it('a full-width bottom rule, no pill track, sideways scroll with a hidden bar and a fade edge', () => {
    tabs('line');
    const list = screen.getByRole('tablist', { name: 'Sections' });
    expect(list).toHaveAttribute('data-variant', 'line');
    expect(list).toHaveClass('w-full', 'justify-start', 'border-b', 'overflow-x-auto', 'scrollbar-none');
    expect(list.className).toMatch(/mask-image/);
    expect(list).not.toHaveClass('bg-muted');
  });

  it('the active tab is underlined in the primary colour on the rule', () => {
    tabs('line');
    const active = screen.getByRole('tab', { name: 'Overview' });
    expect(active).toHaveAttribute('data-state', 'active');
    expect(active.className).toMatch(/after:bg-primary/);
    expect(active.className).toMatch(/after:bottom-0/);
  });

  it('the default variant is unchanged (pill on a muted track)', () => {
    tabs();
    const list = screen.getByRole('tablist');
    expect(list).toHaveClass('bg-muted');
    expect(list).not.toHaveClass('border-b');
  });
});
