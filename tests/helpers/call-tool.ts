type ExecutableTool = { execute?: (...args: never[]) => Promise<unknown> };

/** Call a tool's `execute` directly, erasing Mastra's input-variance at the test boundary. */
export async function callTool<TOutput>(
  tool: ExecutableTool,
  input: unknown,
  context: unknown = {}
): Promise<TOutput> {
  if (!tool.execute) throw new Error('tool has no execute');
  const execute = tool.execute as (input: unknown, context: unknown) => Promise<TOutput>;
  return execute(input, context);
}
