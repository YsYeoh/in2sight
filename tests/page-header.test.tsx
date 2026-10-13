import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '@/components/shared/PageHeader';

describe('PageHeader', () => {
  it('renders one level-1 heading, an optional subtitle and actions', () => {
    render(<PageHeader title="Accounts" subtitle="Connect and monitor" actions={<button>Add</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByText('Connect and monitor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('omits the subtitle and actions containers when not given', () => {
    const { container } = render(<PageHeader title="Tags" />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
