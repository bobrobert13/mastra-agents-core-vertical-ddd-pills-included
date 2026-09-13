import { afterEach, describe, expect, it } from 'vitest';

// PURE module only — this file must never transitively load @mastra/mcp
// (spec 04 DoD: unit tier offline, no SDK).
import {
  defaultMcpApprovalPolicy,
  mcpWarnings,
  parseMcpServers,
  RESERVED_SERVER_KEY,
  type McpServerJsonEntry,
} from '../../../../src/mastra/shared/config/mcp-parse';

const SUFFIX = 'Unset the variable to disable MCP entirely; see .env.example.';

const entryErrorOf = (name: string) => `[MCP] Invalid MCP_SERVERS entry "${name}":`;

const savedEnv: Record<string, string | undefined> = {};

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  for (const key of Object.keys(vars)) {
    savedEnv[key] ??= process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

afterEach(() => {
  // safety net: never leak MCP env into sibling tests
  delete process.env.MCP_TEST_TOKEN;
  delete process.env.MCP_MISSING_VAR;
});

describe('parseMcpServers — unset = off (golden rule)', () => {
  it('undefined → {}', () => {
    expect(parseMcpServers(undefined)).toEqual({});
  });

  it('empty string → {} (counts as unset)', () => {
    expect(parseMcpServers('')).toEqual({});
  });

  it('whitespace-only string → {}', () => {
    expect(parseMcpServers('   ')).toEqual({});
  });

  it("'{}' → {}", () => {
    expect(parseMcpServers('{}')).toEqual({});
  });
});

describe('parseMcpServers — valid fixtures', () => {
  it('parses a stdio entry with routing key', () => {
    const out = parseMcpServers(
      '{"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"],"inheritDefaultEnv":false,"agents":["research"]}}'
    );
    expect(out.wikipedia).toMatchObject({
      command: 'npx',
      args: ['-y', 'wikipedia-mcp'],
      inheritDefaultEnv: false,
      agents: ['research'],
    });
    expect(Object.keys(out)).toEqual(['wikipedia']);
  });

  it('parses an http entry with requestInit + allowedHosts', () => {
    const out = parseMcpServers(
      '{"weather":{"url":"https://weather.example.com/mcp","requestInit":{"headers":{"Authorization":"Bearer xyz"}},"allowedHosts":["weather.example.com"],"timeout":5000,"requireToolApproval":true}}'
    );
    expect(out.weather).toMatchObject({
      url: 'https://weather.example.com/mcp',
      requestInit: { headers: { Authorization: 'Bearer xyz' } },
      allowedHosts: ['weather.example.com'],
      timeout: 5000,
      requireToolApproval: true,
    });
  });

  it('interpolates ${VAR} from process.env in env values', () => {
    const token = '$' + '{MCP_TEST_TOKEN}';
    withEnv({ MCP_TEST_TOKEN: 'secret123' }, () => {
      const out = parseMcpServers(`{"s":{"command":"c","env":{"TOKEN":"${token}"}}}`);
      expect(out.s.env).toEqual({ TOKEN: 'secret123' });
    });
  });

  it('interpolates ${VAR} in requestInit.headers values', () => {
    const token = '$' + '{MCP_TEST_TOKEN}';
    withEnv({ MCP_TEST_TOKEN: 'abc' }, () => {
      const out = parseMcpServers(
        `{"s":{"url":"https://x.example.com/mcp","requestInit":{"headers":{"Authorization":"Bearer ${token}"}}}}`
      );
      expect(out.s.requestInit?.headers?.Authorization).toBe('Bearer abc');
    });
  });
});

describe('parseMcpServers — Scenario 2 fail-fast', () => {
  it('malformed JSON → exact prefix + the three actionable parts', () => {
    let message = '';
    try {
      parseMcpServers('{wikipedia');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.startsWith('[MCP] Invalid MCP_SERVERS: JSON parse failed (')).toBe(true);
    expect(message).toContain('Expected a JSON object of server definitions keyed by server name');
    expect(message).toContain('e.g. {"wikipedia":{"command":"npx","args":["-y","wikipedia-mcp"]}}');
    expect(message).toContain(SUFFIX);
  });

  it('JSON array instead of object → same message family', () => {
    expect(() => parseMcpServers('[]')).toThrow(
      '[MCP] Invalid MCP_SERVERS: expected a JSON object'
    );
  });

  it('entry with neither command nor url → exact transport message', () => {
    expect(() => parseMcpServers('{"x":{"args":["a"]}}')).toThrow(
      `${entryErrorOf('x')} exactly one of "command" (stdio) or "url" (HTTP) is required. ${SUFFIX}`
    );
  });

  it('entry with BOTH command and url → same transport message', () => {
    expect(() =>
      parseMcpServers('{"x":{"command":"c","url":"https://a.example.com/mcp"}}')
    ).toThrow(
      `${entryErrorOf('x')} exactly one of "command" (stdio) or "url" (HTTP) is required. ${SUFFIX}`
    );
  });

  it('transport-exclusive key: requestInit on a stdio entry → entry error', () => {
    expect(() =>
      parseMcpServers('{"x":{"command":"c","requestInit":{"headers":{"a":"b"}}}}')
    ).toThrow(
      `${entryErrorOf('x')} "requestInit" is only valid on "url" (HTTP) entries. ${SUFFIX}`
    );
  });

  it('transport-exclusive key: allowedHosts on a stdio entry → entry error', () => {
    expect(() => parseMcpServers('{"x":{"command":"c","allowedHosts":["a"]}}')).toThrow(
      `${entryErrorOf('x')} "allowedHosts" is only valid on "url" (HTTP) entries. ${SUFFIX}`
    );
  });

  it('transport-exclusive key: env on a url entry → entry error', () => {
    expect(() =>
      parseMcpServers('{"x":{"url":"https://a.example.com/mcp","env":{"A":"b"}}}')
    ).toThrow(`${entryErrorOf('x')} "env" is only valid on "command" (stdio) entries. ${SUFFIX}`);
  });

  it('transport-exclusive key: inheritDefaultEnv on a url entry → entry error', () => {
    expect(() =>
      parseMcpServers('{"x":{"url":"https://a.example.com/mcp","inheritDefaultEnv":false}}')
    ).toThrow(
      `${entryErrorOf('x')} "inheritDefaultEnv" is only valid on "command" (stdio) entries. ${SUFFIX}`
    );
  });

  it('non-http(s) url scheme rejected', () => {
    expect(() => parseMcpServers('{"x":{"url":"file:///tmp/s"}},')).toThrow(
      '[MCP] Invalid MCP_SERVERS'
    );
  });

  it('relative url rejected as not absolute', () => {
    expect(() => parseMcpServers('{"x":{"url":"/mcp"}}')).toThrow(
      `${entryErrorOf('x')} invalid "url": not an absolute URL (/mcp). ${SUFFIX}`
    );
  });

  it(`reserved server key "${RESERVED_SERVER_KEY}" → entry error`, () => {
    expect(() => parseMcpServers('{"boilerplate":{"command":"c"}}')).toThrow(
      `${entryErrorOf('boilerplate')} "boilerplate" is reserved for this project's own exposed MCPServer key. ${SUFFIX}`
    );
  });

  it('unknown key in an entry → entry error (strict schema)', () => {
    expect(() => parseMcpServers('{"x":{"command":"c","nope":true}}')).toThrow(entryErrorOf('x'));
  });

  it('unknown ${MISSING} var → boot error in the same family', () => {
    delete process.env.MCP_MISSING_VAR;
    const ref = '$' + '{MCP_MISSING_VAR}';
    expect(() => parseMcpServers(`{"x":{"command":"c","env":{"TOKEN":"${ref}"}}}`)).toThrow(
      `${entryErrorOf('x')} environment variable "MCP_MISSING_VAR" referenced as ${ref} in env.TOKEN is not set. ${SUFFIX}`
    );
  });
});

describe('mcpWarnings', () => {
  const entry = (over: Partial<McpServerJsonEntry>): Record<string, McpServerJsonEntry> => ({
    s: { command: 'c', ...over },
  });

  it('stdio without inheritDefaultEnv:false → banner warn with the canonical string', () => {
    expect(mcpWarnings(entry({}))).toContainEqual({
      server: 's',
      severity: 'banner',
      message: 's: no inheritDefaultEnv:false — stdio env not isolated',
    });
  });

  it('stdio with inheritDefaultEnv:false → no env warn', () => {
    expect(mcpWarnings(entry({ inheritDefaultEnv: false }))).toEqual([]);
  });

  it('explicit requireToolApproval:false → banner "approval OFF" warn', () => {
    expect(
      mcpWarnings({ s: { url: 'https://a.example.com/mcp', requireToolApproval: false } })
    ).toContainEqual({
      server: 's',
      severity: 'banner',
      message: 's: approval OFF — every tool runs unattended',
    });
  });

  it('url + requestInit.headers → SSE fallback log warn', () => {
    const warns = mcpWarnings({
      s: { url: 'https://a.example.com/mcp', requestInit: { headers: { A: 'b' } } },
    });
    expect(warns.some(w => w.severity === 'log' && w.message.includes('SSE'))).toBe(true);
  });

  it('forwardInstructions:true → log warn', () => {
    const warns = mcpWarnings(entry({ forwardInstructions: true }));
    expect(warns.some(w => w.severity === 'log' && w.message.includes('forwardInstructions'))).toBe(
      true
    );
  });
});

describe('defaultMcpApprovalPolicy — mutating-name matrix (O3)', () => {
  const gated = [
    // snake_case (this repo's real strings + wikipedia-style)
    'delete_page',
    'file-write',
    'create_task',
    'update_task',
    'write_file',
    'edit_file',
    'remove_item',
    'drop_table',
    // namespaced forms produced by listTools()
    'wikipedia_delete_page',
    'jira_create_issue',
    'wikipedia_delete', // boundary: verb at end, no trailing delimiter
    // camelCase / PascalCase via toSnake() normalization (the fixed gap)
    'deleteFile',
    'createIssue',
    'removeItem',
    'updateRecord',
    'WriteNote',
    'editRecord',
  ];
  const open = [
    'search',
    'read_file',
    'status',
    'ping',
    'get_weather',
    'wikipedia_search', // namespaced read stays open
    'research', // prefix contains no delimited verb
    'credit_card', // "create" must NOT match inside a word
    'latest_news', // "delete" must NOT match inside a word
    // documented residual gap (R2): semantics-only names — the floor, not the ceiling
    'purge_all',
    'wipe_bucket',
    'transfer_funds',
  ];

  it.each(gated)('gates %s', name => {
    expect(defaultMcpApprovalPolicy({ toolName: name })).toBe(true);
  });

  it.each(open)('does NOT gate %s', name => {
    expect(defaultMcpApprovalPolicy({ toolName: name })).toBe(false);
  });
});
