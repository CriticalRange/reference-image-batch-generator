'use client';

import { useEffect, useRef, useState } from 'react';
import 'swagger-ui-dist/swagger-ui.css';

type SwaggerUIBundleFn = ((options: Record<string, unknown>) => { destroy?: () => void }) & {
  presets?: { apis: unknown };
};

/**
 * Imperative Swagger UI (swagger-ui-dist) — avoids swagger-ui-react class
 * lifecycle warnings under React 19 Strict Mode (UNSAFE_componentWillReceiveProps).
 */
export function SwaggerUiClient() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    let ui: { destroy?: () => void } | undefined;

    async function mountSwagger() {
      if (!hostRef.current) return;

      try {
        // Bundle is UMD; webpack/turbopack expose the factory as default or named export.
        const mod = (await import('swagger-ui-dist/swagger-ui-bundle.js')) as {
          default?: SwaggerUIBundleFn;
          SwaggerUIBundle?: SwaggerUIBundleFn;
        };

        const SwaggerUIBundle = mod.default ?? mod.SwaggerUIBundle;
        if (typeof SwaggerUIBundle !== 'function') {
          throw new Error('SwaggerUIBundle failed to load.');
        }

        if (cancelled || !hostRef.current) return;

        // Ensure a clean mount (Strict Mode remounts in dev).
        hostRef.current.innerHTML = '';
        const mountNode = document.createElement('div');
        hostRef.current.appendChild(mountNode);

        ui = SwaggerUIBundle({
          url: '/api/openapi',
          domNode: mountNode,
          deepLinking: true,
          docExpansion: 'list',
          defaultModelsExpandDepth: 0,
          defaultModelExpandDepth: 1,
          defaultModelRendering: 'example',
          tryItOutEnabled: true,
          displayRequestDuration: true,
          filter: true,
          showExtensions: true,
          persistAuthorization: true,
          displayOperationId: false,
          presets: SwaggerUIBundle.presets ? [SwaggerUIBundle.presets.apis] : undefined,
          layout: 'BaseLayout'
        });

        if (!cancelled) {
          setStatus('ready');
        }
      } catch (error) {
        console.error('[api-docs] Swagger UI failed to mount', error);
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load Swagger UI.');
        }
      }
    }

    void mountSwagger();

    return () => {
      cancelled = true;
      try {
        ui?.destroy?.();
      } catch {
        // ignore teardown errors from swagger-ui
      }
      if (hostRef.current) {
        hostRef.current.innerHTML = '';
      }
    };
  }, []);

  return (
    <div className="api-docs-swagger">
      {status === 'loading' ? (
        <p className="api-docs-loading" role="status">
          Loading API documentation…
        </p>
      ) : null}
      {status === 'error' ? (
        <p className="api-docs-loading" role="alert">
          {errorMessage}{' '}
          <a href="/api/openapi">Open raw OpenAPI</a> instead.
        </p>
      ) : null}
      <div ref={hostRef} className="api-docs-swagger-host" />
    </div>
  );
}
