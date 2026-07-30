import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Docs · Batch Image Generator',
  description: 'OpenAPI reference for the generation HTTP API'
};

export default function ApiDocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
