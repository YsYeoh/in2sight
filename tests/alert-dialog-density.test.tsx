import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

describe('AlertDialog buttons stay under the button density rules', () => {
  it('Action and Cancel render data-slot="button" with a data-size', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Detail</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction>Yes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    for (const name of ['No', 'Yes']) {
      const b = screen.getByRole('button', { name });
      expect(b).toHaveAttribute('data-slot', 'button');
      expect(b).toHaveAttribute('data-size');
    }
  });
});
