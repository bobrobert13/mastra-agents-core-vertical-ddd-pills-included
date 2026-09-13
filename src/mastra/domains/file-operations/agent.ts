import { Agent } from '@mastra/core/agent';
import { agentModel } from '../../shared/config/model';
import { buildDomainMemory } from '../../shared/config/vectors';
import { createScopeGuard, type DomainScope } from '../../shared/processors/scope-guard';
import { buildSecurityStack } from '../../shared/processors/security-stack';
import { agentScorersFor } from '../../shared/evals';
import { scopedInstructions } from '../../shared/agents/scoped-instructions';
import { readFileTool } from './tools/read-file';
import { writeFileTool } from './tools/write-file';
import { editFileTool } from './tools/edit-file';

export const fileOperationsScope: DomainScope = {
  domain: 'file-operations',
  agentName: 'File Operations Agent',
  scope: 'local file operations — reading, writing or editing files at paths the user provides',
  outOfScopeExamples: [
    'general-knowledge, historical or religious questions (answer ONLY from files, never from memory)',
    'web research requests',
    'task creation or scheduling',
    'anything that does not involve a concrete local file',
  ],
  siblings: [
    { name: 'Research Agent', description: 'web research: search, fetch and summarize sources' },
    { name: 'Task Management Agent', description: 'create, update and schedule tasks' },
    { name: 'Communication Agent', description: 'clarify user intent with structured questions' },
  ],
};

export const fileOperationsScopeGuard = createScopeGuard(fileOperationsScope);
// Spec 06 hard rule: processor arrays come from buildSecurityStack (scope guard is slot 0).
// disableResponseCache: cache hits replay tool calls — mutating agents are excluded (spec 06 R2).
export const fileOperationsSecurityStack = buildSecurityStack({
  scope: fileOperationsScope,
  disableResponseCache: true,
});

export const fileOperationsAgent = new Agent({
  id: 'file-operations-agent',
  name: 'File Operations Agent',
  description: 'Specialized agent for file system operations',
  instructions: scopedInstructions(
    fileOperationsScope,
    `You are a file operations specialist. Help users read, write, and edit files.

Your capabilities:
- Read file contents
- Write new files or overwrite existing ones
- Edit files by finding and replacing text

When working with files:
1. Always confirm the file path with the user
2. Read before writing when editing
3. Be careful with destructive operations
4. Provide clear feedback on what was done
5. Handle errors gracefully

Always be precise and cautious with file operations.`
  ),
  model: agentModel.files(),
  defaultOptions: {
    maxSteps: 20,
    autoResumeSuspendedTools: true,
  },
  inputProcessors: fileOperationsSecurityStack.inputProcessors,
  outputProcessors: fileOperationsSecurityStack.outputProcessors,
  scorers: agentScorersFor('file-operations-agent'), // spec 07 §3.2 (live-run score emission → Studio; thresholds are runEvals/experiment concerns)
  memory: buildDomainMemory({
    generateTitle: true,
  }),
  tools: {
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
  },
});
