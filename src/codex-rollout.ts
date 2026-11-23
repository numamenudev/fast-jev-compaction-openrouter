import type { Message } from './types.js';

const callTypes = new Set(['function_call', 'custom_tool_call', 'local_shell_call']);
const outputTypes = new Set(['function_call_output', 'custom_tool_call_output', 'local_shell_call_output']);

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
}

function toolInput(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Custom tools also accept raw text.
    }
  }
  return { input: value };
}

function append(messages: Message[], payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const item = payload as Record<string, unknown>;
  if (item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) {
    const text = contentText(item.content);
    if (text) messages.push({ role: item.role, text, toolUses: [] });
    return;
  }
  const callId = item.call_id ?? (item.type === 'local_shell_call' ? item.id : undefined);
  if (typeof item.type !== 'string' || typeof callId !== 'string') return;
  if (callTypes.has(item.type)) {
    messages.push({
      role: 'assistant',
      text: '',
      toolUses: [{
        tool_use_id: callId,
        tool: typeof item.name === 'string' ? item.name : item.type,
        input: toolInput(item.arguments ?? item.input ?? item.action ?? {}),
      }],
    });
  }
  if (outputTypes.has(item.type)) {
    const output = item.output;
    const text = typeof output === 'string' ? output : (JSON.stringify(output) ?? '');
    messages.push({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: callId, text }] });
  }
}

export function parseRollout(rollout: string): Message[] {
  const messages: Message[] = [];
  const lines = rollout.split('\n');
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      if (index === lines.length - 1) break; // Codex may still be appending this line.
      throw error;
    }
    if (record?.type === 'compacted') {
      messages.length = 0;
      const replacement = record.payload?.replacement_history;
      if (Array.isArray(replacement)) {
        for (const item of replacement) append(messages, item);
      }
    }
    if (record?.type === 'response_item') append(messages, record.payload);
  }
  return messages;
}
