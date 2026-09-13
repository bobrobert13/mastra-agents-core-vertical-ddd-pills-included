import { MastraError, ErrorDomain, ErrorCategory } from '@mastra/core/error';

/**
 * Minimal structural view of a Mastra Tool for direct execution.
 * Real Tool instances are assignable (input is widened to never).
 */
interface ExecutableTool {
  id: string;
  execute?: (input: never, context: never) => Promise<unknown>;
}

/**
 * Directly invoke a tool's execute function (workflows, tests).
 * Agents should keep calling tools through the model loop — this helper
 * exists for deterministic step-level composition and unit tests.
 */
export async function runTool<TOutput extends object>(
  tool: ExecutableTool,
  inputData: Record<string, unknown>
): Promise<TOutput> {
  if (!tool.execute) {
    throw new MastraError({
      id: 'TOOL_HAS_NO_EXECUTE',
      domain: ErrorDomain.TOOL,
      category: ErrorCategory.SYSTEM,
      text: `Tool "${tool.id}" has no execute function`,
    });
  }

  // Minimal execution context: direct calls carry no runtime/request state.
  const context = {
    mastra: undefined,
    threadId: undefined,
    resourceId: undefined,
    agentName: undefined,
    toolCallId: `direct-${tool.id}`,
    messages: [],
    logger: undefined,
    workspaces: undefined,
    workspace: undefined,
    requestContext: undefined,
    experimentalContext: undefined,
  } as never;

  const result = await tool.execute(inputData as never, context);

  if (result === undefined || result === null) {
    throw new MastraError({
      id: 'TOOL_RETURNED_NO_OUTPUT',
      domain: ErrorDomain.TOOL,
      category: ErrorCategory.SYSTEM,
      text: `Tool "${tool.id}" returned no output`,
    });
  }

  if (typeof result === 'object' && 'error' in result && Object.keys(result).length === 1) {
    throw new MastraError({
      id: 'TOOL_VALIDATION_ERROR',
      domain: ErrorDomain.TOOL,
      category: ErrorCategory.USER,
      text: `Tool "${tool.id}" input validation failed: ${String(result.error)}`,
    });
  }

  return result as TOutput;
}
