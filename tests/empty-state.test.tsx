import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '@/components/shared/EmptyState';

describe('EmptyState', () => {
  it('shows title, description and action', () => {
    render(<EmptyState title="No accounts yet" description="Connect one to start" action={<button>Add account</button>} />);
    expect(screen.getByText('No accounts yet')).toBeInTheDocument();
    expect(screen.getByText('Connect one to start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });

  it('is a status region so screen readers hear it', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
  });
});
