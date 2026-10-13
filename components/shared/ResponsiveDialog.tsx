'use client';

import type { ComponentProps } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// Below `md` the panel is pinned to the bottom edge (a sheet) and slides up instead of zooming;
// from `md` up it is the normal centred dialog. Pure CSS: server and client render the same markup.
const SHEET = [
  'max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:translate-x-0 max-md:translate-y-0',
  'max-md:max-w-none sm:max-md:max-w-none max-md:w-full max-md:rounded-b-none max-md:max-h-[90dvh] max-md:overflow-y-auto',
  // neutralise the dialog's zoom animation (scale back to 100%) and slide from the bottom edge
  'max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100',
  'max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=closed]:slide-out-to-bottom',
].join(' ');

export const ResponsiveDialog = Dialog;
export const ResponsiveDialogTrigger = DialogTrigger;
export const ResponsiveDialogClose = DialogClose;
export const ResponsiveDialogHeader = DialogHeader;
export const ResponsiveDialogTitle = DialogTitle;
export const ResponsiveDialogDescription = DialogDescription;
export const ResponsiveDialogFooter = DialogFooter;

export function ResponsiveDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent className={cn(SHEET, className)} {...props} />;
}
