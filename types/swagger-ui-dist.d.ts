declare module 'swagger-ui-dist/swagger-ui-bundle.js' {
  type SwaggerUIBundleFn = ((options: Record<string, unknown>) => { destroy?: () => void }) & {
    presets?: { apis: unknown };
  };

  const SwaggerUIBundle: SwaggerUIBundleFn;
  export default SwaggerUIBundle;
  export { SwaggerUIBundle };
}

declare module 'swagger-ui-dist/swagger-ui.css';
