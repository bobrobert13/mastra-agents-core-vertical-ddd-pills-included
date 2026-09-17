import { buildDomainAgent, createScopeGuard } from '../../shared/agents/build-agent';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { readFileTool } from './tools/read-file';
import { writeFileTool } from './tools/write-file';
import { editFileTool } from './tools/edit-file';
import { fileOperationsScope } from './scope';
import { fileOperationsSettings } from './config';
import { fileOperationsInstructions } from './instructions';

// Kept for backward compat — structural wiring tests reference these exports
export const fileOperationsScopeGuard = createScopeGuard(fileOperationsScope);
export const fileOperationsSecurityStack = buildSecurityStack({
  scope: fileOperationsScope,
  disableResponseCache: true, // cache hits replay tool calls — mutating agents are excluded (spec 06 R2)
});

export const fileOperationsAgent = buildDomainAgent({
  scope: fileOperationsScope,
  instructionsBody: fileOperationsInstructions,
  tools: { read_file: readFileTool, write_file: writeFileTool, edit_file: editFileTool },
  ...fileOperationsSettings,
});
