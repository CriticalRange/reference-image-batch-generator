'use client';

import { Toaster } from 'sonner';

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      expand
      offset={20}
      mobileOffset={{ bottom: 88, right: 12 }}
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
