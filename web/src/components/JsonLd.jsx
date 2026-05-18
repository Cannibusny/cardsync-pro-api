import { useEffect, useRef } from 'react';

/**
 * Injects Schema.org JSON-LD script tags into <head>.
 * Cleans up on unmount or when schema changes.
 * @param {{ schema: object | object[] }} props
 */
export default function JsonLd({ schema }) {
  const nodesRef = useRef([]);

  useEffect(() => {
    nodesRef.current.forEach((el) => el.remove());
    nodesRef.current = [];

    const schemas = Array.isArray(schema) ? schema : [schema];

    schemas.forEach((s) => {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(s, null, 2);
      document.head.appendChild(script);
      nodesRef.current.push(script);
    });

    return () => {
      nodesRef.current.forEach((el) => el.remove());
      nodesRef.current = [];
    };
  }, [schema]);

  return null;
}
