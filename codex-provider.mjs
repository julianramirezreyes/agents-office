import path from 'node:path';

const VALID_SANDBOX = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const VALID_APPROVAL = new Set(['untrusted', 'on-request', 'on-failure', 'never']);
const CODEX_ALIAS = /^(?:sonnet|opus|fable)$/i;
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

function messageOf(error) {
  return error instanceof Error && error.message ? error.message : 'Codex returned an unspecified error';
}

export function createCodexProvider({ sdk, codexHome, workspaceRoot = process.cwd(), policy = {} } = {}) {
  const root = path.resolve(workspaceRoot);
  const sandboxMode = policy.sandboxMode ?? 'workspace-write';
  const approvalPolicy = policy.approvalPolicy ?? 'on-request';
  let codex;
  let importedSdk;

  async function getCodex() {
    if (codex) return codex;
    const module = sdk || (importedSdk ||= await import('@openai/codex-sdk'));
    const Codex = module.Codex || module.default;
    if (typeof Codex !== 'function') throw new Error('Codex SDK is unavailable');
    // Omitting options preserves the SDK's normal CODEX_HOME and process environment inheritance.
    codex = new Codex();
    return codex;
  }

  return {
    capabilities() {
      return { available: 'unknown', models: null, tools: null, controls: { sandbox: sandboxMode, approval: approvalPolicy } };
    },

    async runTask({ taskId, prompt, cwd = root, model, approvalPolicy: requestedApproval = approvalPolicy, onEvent } = {}) {
      const workingDirectory = path.resolve(cwd);
      if (!inside(root, workingDirectory)) {
        return { status: 'blocked', error: 'Requested working directory is outside the Codex workspace policy', taskId, provider: 'codex' };
      }
      if (!VALID_SANDBOX.has(sandboxMode) || !VALID_APPROVAL.has(approvalPolicy)) {
        return { status: 'blocked', error: 'Configured Codex policy is unsupported; no task was started', taskId, provider: 'codex' };
      }
      if (requestedApproval !== approvalPolicy) {
        return { status: 'blocked', error: 'Requested approval policy is not supported by the configured Codex policy', taskId, provider: 'codex' };
      }
      if (model && CODEX_ALIAS.test(model)) {
        return { status: 'blocked', error: 'Claude model aliases are not valid Codex model identifiers', taskId, provider: 'codex' };
      }
      let thread;
      let threadId;
      try {
        const client = await getCodex();
        const options = { workingDirectory, sandboxMode, approvalPolicy };
        if (model) options.model = model;
        thread = client.startThread(options);
        const streamed = await thread.runStreamed(String(prompt || ''));
        const events = streamed?.events || streamed;
        let text = '';
        let usage;
        let eventError;
        for await (const event of events) {
          if (event?.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
          if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') text = event.item.text;
          if (event?.type === 'turn.completed' && event.usage) usage = event.usage;
          if (event?.type === 'turn.failed' || event?.type === 'error') eventError = event.message || event.error?.message || 'Codex turn failed';
          if (typeof onEvent === 'function') onEvent(event);
        }
        const completed = streamed?.completed ? await streamed.completed : undefined;
        threadId ||= typeof thread?.id === 'string' ? thread.id : (typeof completed?.threadId === 'string' ? completed.threadId : undefined);
        if (eventError) return { status: 'failed', threadId, text, usage, error: eventError, taskId, provider: 'codex' };
        if (!text) return { status: 'failed', threadId, text: '', usage, error: 'Codex completed without a final assistant message', taskId, provider: 'codex' };
        return { status: 'completed', threadId, text, usage, error: null, taskId, provider: 'codex' };
      } catch (error) {
        threadId ||= typeof thread?.id === 'string' ? thread.id : undefined;
        return { status: 'failed', threadId, text: '', usage: undefined, error: messageOf(error), taskId, provider: 'codex' };
      }
    },

    async close() {},
  };
}
