import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from '@/components/shared/FormField';
import { Input } from '@/components/ui/input';

const field = (props: Partial<React.ComponentProps<typeof FormField>> = {}) =>
  render(
    <FormField id="email" label="Email" {...props}>
      {(p) => <Input {...p} />}
    </FormField>,
  );

describe('FormField', () => {
  it('connects the label to the control', () => {
    field();
    expect(screen.getByLabelText('Email')).toHaveAttribute('id', 'email');
  });

  it('shows the hint and links it with aria-describedby', () => {
    field({ hint: 'We never share it' });
    const input = screen.getByLabelText('Email');
    const hint = screen.getByText('We never share it');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('an error replaces the hint visually, but both stay announced', () => {
    field({ hint: 'We never share it', error: 'Enter a valid email' });
    const input = screen.getByLabelText('Email');
    const hint = screen.getByText('We never share it');
    expect(hint).toHaveClass('sr-only');
    const err = screen.getByRole('alert');
    expect(err).toHaveTextContent('Enter a valid email');
    expect(err).not.toHaveClass('sr-only');
    expect(input.getAttribute('aria-describedby')).toBe(`${err.id} ${hint.id}`);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('marks required fields visibly but not by colour alone', () => {
    field({ required: true });
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeRequired();
  });

  it('without hint or error the control has no aria-describedby', () => {
    field();
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-describedby');
  });
});
