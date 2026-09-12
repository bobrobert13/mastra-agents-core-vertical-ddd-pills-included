import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { agentModel, memoryModel } from '../../shared/config/model';
import { readFileTool } from './tools/read-file';
import { writeFileTool } from './tools/write-file';
import { editFileTool } from './tools/edit-file';

export const fileOperationsAgent = new Agent({
  id: 'file-operations-agent',
  name: 'File Operations Agent',
  description: 'Specialized agent for file system operations',
  instructions: `You are a file operations specialist. Help users read, write, and edit files.

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

Always be precise and cautious with file operations.`,
  model: agentModel.files(),
  defaultOptions: {
    maxSteps: 20,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  tools: {
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
  },
});
