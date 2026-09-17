import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createStep } from '@mastra/core/workflows';

import type { KnowledgeContentType } from '../../entities/document';
import { readDocSchema, workflowInputSchema } from '../schemas';

/**
 * `read-document` — resolve the source (path with workspace containment, or
 * inline content), derive a stable docId, and hand the raw text downstream.
 */

/** Path-containment check: workspace root (process cwd) + workspace/ dir only. */
function assertInsideWorkspace(resolved: string): void {
  const roots = [process.cwd(), path.join(process.cwd(), 'workspace')];
  const inside = roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
  if (!inside) {
    throw new Error(
      `index-knowledge: path "${resolved}" escapes the workspace root (path containment)`
    );
  }
}

function contentTypeFromExtension(
  filePath: string,
  fallback: KnowledgeContentType
): KnowledgeContentType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.html' || ext === '.htm') return 'html';
  return fallback;
}

export function createReadDocumentStep() {
  return createStep({
    id: 'read-document',
    inputSchema: workflowInputSchema,
    outputSchema: readDocSchema,
    execute: async ({ inputData }) => {
      let text: string;
      let source: string;
      let contentType: KnowledgeContentType = inputData.contentType;

      if (inputData.source === 'path') {
        const resolved = path.resolve(inputData.path ?? '');
        assertInsideWorkspace(resolved);
        text = await readFile(resolved, 'utf8');
        source = resolved;
        contentType = contentTypeFromExtension(resolved, contentType);
      } else {
        text = inputData.content ?? '';
        source = 'inline';
      }

      const docId = inputData.docId ?? createHash('sha256').update(text).digest('hex').slice(0, 16);
      return { docId, text, contentType, source };
    },
  });
}
