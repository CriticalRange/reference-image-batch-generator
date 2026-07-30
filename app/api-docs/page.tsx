import Link from 'next/link';
import { SwaggerUiClient } from './swagger-ui-client';

export default function ApiDocsPage() {
  return (
    <div className="api-docs-shell">
      <header className="api-docs-header">
        <div className="api-docs-header-inner">
          <div>
            <p className="api-docs-kicker">HTTP API</p>
            <h1 className="api-docs-title">OpenAPI reference</h1>
            <p className="api-docs-subtitle">
              Interactive docs for generation and model list endpoints. Spec file:{' '}
              <code>docs/openapi.yaml</code> · live URL: <code>/api/openapi</code>
            </p>
          </div>
          <div className="api-docs-actions">
            <Link href="/" className="api-docs-link">
              ← Back to app
            </Link>
            <a href="/api/openapi" className="api-docs-link api-docs-link-secondary">
              Open raw OpenAPI
            </a>
          </div>
        </div>
      </header>
      <SwaggerUiClient />
    </div>
  );
}
