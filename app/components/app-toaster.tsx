'use client';

import { Toaster } from 'sonner';

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      expand
      toastOptions={{
        classNames: {
          toast: 'cool-toast',
          title: 'cool-toast-title',
          description: 'cool-toast-description',
          error: 'cool-toast-error'
        }
      }}
    />
  );
}
