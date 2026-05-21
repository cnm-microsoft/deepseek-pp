import { TOOL_CALL_REGEX } from '../constants';
import type { ToolCall } from '../types';

const LEGACY_TOOL_CALLS_BLOCK_REGEX = /<｜DSML｜tool_calls>\s*[\s\S]*?\s*<\/｜DSML｜tool_calls>/g;
const LEGACY_INVOKE_REGEX = /<｜DSML｜invoke name="([^"]+)">\s*([\s\S]*?)\s*<\/｜DSML｜invoke>/g;
const LEGACY_PARAMETER_REGEX = /<｜DSML｜parameter name="([^"]+)" string="(true|false)">([\s\S]*?)<\/｜DSML｜parameter>/g;

export function extractToolCalls(text: string): ToolCall[] {
  return [
    ...extractXmlToolCalls(text),
    ...extractLegacyToolCalls(text),
  ];
}

function extractXmlToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const regex = new RegExp(TOOL_CALL_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const body = match[2].trim();
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') {
        payload = parsed;
      }
    } catch {
      // body wasn't JSON; skip
      continue;
    }
    calls.push({ name, payload, raw: match[0] });
  }

  return calls;
}

function extractLegacyToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const blockRegex = new RegExp(LEGACY_TOOL_CALLS_BLOCK_REGEX.source, 'g');
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const blockContent = blockMatch[0];
    const invokeRegex = new RegExp(LEGACY_INVOKE_REGEX.source, 'g');
    let invokeMatch: RegExpExecArray | null;

    while ((invokeMatch = invokeRegex.exec(blockContent)) !== null) {
      const name = invokeMatch[1];
      const invokeContent = invokeMatch[2];
      const payload: Record<string, unknown> = {};
      const paramRegex = new RegExp(LEGACY_PARAMETER_REGEX.source, 'g');
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
        const paramName = paramMatch[1];
        const isString = paramMatch[2] === 'true';
        const value = paramMatch[3];
        if (isString) {
          payload[paramName] = value;
          continue;
        }
        try {
          payload[paramName] = JSON.parse(value);
        } catch {
          payload[paramName] = value;
        }
      }

      calls.push({ name, payload, raw: invokeMatch[0] });
    }
  }

  return calls;
}

export function stripToolCalls(text: string): string {
  const regex = new RegExp(TOOL_CALL_REGEX.source, 'g');
  const legacyRegex = new RegExp(LEGACY_TOOL_CALLS_BLOCK_REGEX.source, 'g');
  return text.replace(regex, '').replace(legacyRegex, '').trim();
}

export function replaceToolCallsWithSummary(text: string): string {
  const regex = new RegExp(TOOL_CALL_REGEX.source, 'g');
  const legacyRegex = new RegExp(LEGACY_TOOL_CALLS_BLOCK_REGEX.source, 'g');
  return text.replace(regex, replaceMatchWithSummary).replace(legacyRegex, replaceMatchWithSummary);
}

function replaceMatchWithSummary(match: string): string {
  const calls = extractToolCalls(match);
  if (calls.length === 0) return '';
  const lines = calls.map(call => {
    const name = call.name;
    const detail = (call.payload as any).name || (call.payload as any).content || (call.payload as any).id || '';
    return `• ${formatToolName(name)}${detail ? '：' + detail : ''}`;
  });
  return '\n\n---\n🔧 已执行工具（' + calls.length + '次）\n' + lines.join('\n') + '\n---';
}

function formatToolName(name: string): string {
  switch (name) {
    case 'memory_save': return '保存记忆';
    case 'memory_update': return '更新记忆';
    case 'memory_delete': return '删除记忆';
    default: return name;
  }
}
