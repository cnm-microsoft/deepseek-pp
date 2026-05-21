import type {
  BackgroundConfig,
  Memory,
  ModelType,
  Skill,
  SystemPromptPreset,
  ToolCall,
  ToolCardResult,
  ToolCallRestoreRecord,
  ToolExecutionRecord,
} from '../core/types';
import { TOOL_NAMES } from '../core/constants';
import { normalizeBackgroundConfig } from '../core/background/config';
import { stripToolCalls } from '../core/interceptor/tool-parser';
import {
  AUTOMATION_BRIDGE_TIMEOUT_MS,
  AUTOMATION_WINDOW_RUN_REQUEST,
  CONTENT_WINDOW_SOURCE,
  createAutomationRunnerFailure,
  isAutomationContentRunMessage,
  isAutomationWindowRunResultMessage,
} from '../core/automation/messages';
import type { AutomationRunnerRequest, AutomationRunnerResult } from '../core/automation/types';

const TOOL_BLOCK_ID = 'dpp-tool-block';
const TOOL_BLOCK_STYLE_ID = 'dpp-tool-block-css';
const TOOL_RESTORE_STORAGE_KEY = 'dpp_tool_execution_blocks';
const TOOL_TAG_PATTERN = TOOL_NAMES.map(escapeRegExp).join('|');
const TOOL_OPEN_TAG_RE = new RegExp(`<\\s*(${TOOL_TAG_PATTERN})\\s*>`, 'i');
const TOOL_MARKER_RE = new RegExp(`<\\s*/?\\s*(?:${TOOL_TAG_PATTERN})\\s*>`, 'i');

interface PersistedToolBlock extends ToolCallRestoreRecord {
  source: 'storage';
  url: string;
  createdAt: number;
}

let toolExecutions: ToolExecutionRecord[] = [];
let toolBlockEl: HTMLElement | null = null;
const restoredToolRecords = new Map<string, ToolCallRestoreRecord>();
let restoredRenderTimer: ReturnType<typeof setTimeout> | null = null;
let restoredRenderAttempts = 0;
const pendingToolExecutionTasks = new Set<Promise<ToolCardResult>>();
let backgroundPatchObserver: MutationObserver | null = null;

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_start',
  async main() {
    const handleMainWorldMessage = async (event: MessageEvent) => {
      if (event.data?.source !== 'deepseek-pp-main') return;

      switch (event.data.type) {
        case 'TOOL_CALL': {
          const call = event.data.data as ToolCall;
          void runToolExecution(call);
          break;
        }
        case 'EXECUTE_TOOL_CALL': {
          const call = event.data.data as ToolCall;
          const id = event.data.id as string;
          const result = await runToolExecution(call);
          window.postMessage({
            source: 'deepseek-pp-content',
            type: 'TOOL_CALL_RESULT',
            id,
            result,
          });
          break;
        }
        case 'RESTORE_TOOL_CALLS': {
          rememberRestoredToolRecords(event.data.records as ToolCallRestoreRecord[]);
          break;
        }
        case 'MEMORIES_USED': {
          const ids = event.data.ids as number[];
          await chrome.runtime.sendMessage({ type: 'TOUCH_MEMORIES', payload: { ids } });
          break;
        }
        case 'RESPONSE_COMPLETE': {
          await waitForPendingToolExecutions();
          if (toolExecutions.length > 0) {
            await persistToolExecutions(toolExecutions, event.data.text as string | undefined);
            collapseToolBlock();
            toolExecutions = [];
            toolBlockEl = null;
          }
          break;
        }
      }
    };

    window.addEventListener('message', handleMainWorldMessage);

    await new Promise((r) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') r(undefined);
      else document.addEventListener('DOMContentLoaded', () => r(undefined), { once: true });
    });

    const [memories, skills, activePreset, modelType] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }),
      chrome.runtime.sendMessage({ type: 'GET_SKILLS' }),
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PRESET' }),
      chrome.runtime.sendMessage({ type: 'GET_MODEL_TYPE' }),
    ]);

    syncToMainWorld(memories ?? [], skills ?? [], activePreset, modelType);
    startRenderedToolCallCleaner();
    void restorePersistedToolBlocks();

    chrome.runtime.sendMessage({ type: 'GET_BACKGROUND' }).then((cfg: BackgroundConfig | null) => {
      applyBackground(cfg);
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isAutomationContentRunMessage(message)) {
        forwardAutomationRunToMainWorld(message.payload)
          .then(sendResponse)
          .catch((err) => {
            sendResponse(
              createAutomationRunnerFailure(
                message.payload,
                'automation_content_bridge_failed',
                err instanceof Error ? err.message : String(err),
                'bridge',
                true,
              ),
            );
          });
        return true;
      }

      if (message.type === 'STATE_UPDATED') {
        syncToMainWorld(message.memories, message.skills, message.activePreset, message.modelType);
      } else if (message.type === 'BACKGROUND_UPDATED') {
        applyBackground(message.config as BackgroundConfig | null);
      }
      return undefined;
    });
  },
});

function forwardAutomationRunToMainWorld(request: AutomationRunnerRequest): Promise<AutomationRunnerResult> {
  return new Promise((resolve) => {
    const id = request.runId;
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', handleResult);
      resolve(
        createAutomationRunnerFailure(
          request,
          'automation_bridge_timeout',
          'Timed out waiting for the DeepSeek page runner.',
          'bridge',
          false,
        ),
      );
    }, AUTOMATION_BRIDGE_TIMEOUT_MS);

    const handleResult = (event: MessageEvent) => {
      if (!isAutomationWindowRunResultMessage(event.data)) return;
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleResult);
      resolve(event.data.result);
    };

    window.addEventListener('message', handleResult);
    window.postMessage({
      source: CONTENT_WINDOW_SOURCE,
      type: AUTOMATION_WINDOW_RUN_REQUEST,
      id,
      payload: request,
    });
  });
}

function runToolExecution(call: ToolCall): Promise<ToolCardResult> {
  const task = executeToolCall(call)
    .catch((err): ToolCardResult => ({
      ok: false,
      summary: '执行失败',
      detail: err instanceof Error ? err.message : String(err),
    }))
    .then((result) => {
      toolExecutions.push({ name: call.name, result });
      renderToolBlock();
      return result;
    });

  pendingToolExecutionTasks.add(task);
  void task.finally(() => {
    pendingToolExecutionTasks.delete(task);
  });
  return task;
}

async function waitForPendingToolExecutions() {
  while (pendingToolExecutionTasks.size > 0) {
    await Promise.allSettled(Array.from(pendingToolExecutionTasks));
  }
}

function syncToMainWorld(memories: Memory[], skills: Skill[], activePreset: SystemPromptPreset | null, modelType: ModelType) {
  window.postMessage({
    source: 'deepseek-pp-content',
    type: 'SYNC_STATE',
    memories,
    skills,
    activePreset,
    modelType,
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getToolBlockUrl(): string {
  return `${location.origin}${location.pathname}${location.search}`;
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, '').trim();
}

async function getPersistedToolBlocks(): Promise<PersistedToolBlock[]> {
  try {
    const stored = await chrome.storage.local.get(TOOL_RESTORE_STORAGE_KEY);
    const blocks = stored?.[TOOL_RESTORE_STORAGE_KEY];
    return Array.isArray(blocks) ? blocks : [];
  } catch {
    return [];
  }
}

async function persistToolExecutions(executions: ToolExecutionRecord[], fullText?: string) {
  if (executions.length === 0) return;

  const content = fullText ? stripToolCalls(fullText) : '';
  const url = getToolBlockUrl();
  const id = hashString(`${url}\n${content}\n${JSON.stringify(executions)}`);
  const block: PersistedToolBlock = {
    id,
    source: 'storage',
    url,
    createdAt: Date.now(),
    content,
    executions: executions.map((execution) => ({
      name: execution.name,
      result: execution.result,
    })),
  };

  const existing = await getPersistedToolBlocks();
  const next = [
    ...existing.filter((item) => item.id !== id),
    block,
  ]
    .filter((item) => Date.now() - item.createdAt < 1000 * 60 * 60 * 24 * 30)
    .slice(-100);

  await chrome.storage.local.set({ [TOOL_RESTORE_STORAGE_KEY]: next });
}

async function restorePersistedToolBlocks() {
  const url = getToolBlockUrl();
  const blocks = await getPersistedToolBlocks();
  rememberRestoredToolRecords(
    blocks
      .filter((block) => shouldTryRestoreToolBlock(block, url))
      .map((block) => ({ ...block, source: 'storage' as const })),
  );
}

function shouldTryRestoreToolBlock(block: PersistedToolBlock, currentUrl: string): boolean {
  if (block.url === currentUrl) return true;

  try {
    return new URL(block.url).origin === location.origin;
  } catch {
    return false;
  }
}

function rememberRestoredToolRecords(records: ToolCallRestoreRecord[] | undefined) {
  if (!records || records.length === 0) return;

  let changed = false;
  for (const record of records) {
    if (!record.id || restoredToolRecords.has(record.id)) continue;
    restoredToolRecords.set(record.id, record);
    changed = true;
  }

  if (changed) {
    scheduleRenderRestoredToolBlocks();
  }
}

async function executeToolCall(call: ToolCall): Promise<ToolCardResult> {
  try {
    if (call.name === 'memory_save') {
      const payload = call.payload as {
        type?: string;
        name?: string;
        content?: string;
        tags?: string[];
      };
      const saved = await chrome.runtime.sendMessage({
        type: 'SAVE_MEMORY',
        payload: {
          type: payload.type || 'topic',
          name: payload.name || 'unnamed',
          content: payload.content || '',
          description: payload.name || '',
          tags: payload.tags || [],
          pinned: false,
        },
      });
      if (!saved?.id) {
        return { ok: false, summary: '保存失败', detail: '未收到保存确认' };
      }
      return { ok: true, summary: '已保存', detail: payload.name || '' };
    }

    if (call.name === 'memory_update') {
      const payload = call.payload as {
        id?: number;
        type?: string;
        name?: string;
        content?: string;
        tags?: string[];
      };
      const id = Number(payload.id);
      if (!id) return { ok: false, summary: '无效 ID' };
      const existing = await chrome.runtime.sendMessage({ type: 'GET_MEMORY_BY_ID', payload: { id } });
      if (!existing) return { ok: false, summary: '未找到记忆', detail: `ID ${id} 不存在` };
      await chrome.runtime.sendMessage({
        type: 'UPDATE_MEMORY',
        payload: {
          ...existing,
          type: payload.type || existing.type,
          name: payload.name || existing.name,
          content: payload.content || existing.content,
          description: payload.name || existing.description,
          tags: payload.tags || existing.tags,
        },
      });
      return { ok: true, summary: '已更新', detail: payload.name || existing.name };
    }

    if (call.name === 'memory_delete') {
      const payload = call.payload as { id?: number };
      const id = Number(payload.id);
      if (!id) return { ok: false, summary: '无效 ID' };
      await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } });
      return { ok: true, summary: '已删除', detail: `#${id}` };
    }

    return { ok: true, summary: '已识别' };
  } catch (err) {
    return { ok: false, summary: '执行失败', detail: err instanceof Error ? err.message : String(err) };
  }
}

// --- Tool execution collapsible block (matches official "已思考" style) ---

function injectToolBlockStyles() {
  if (document.getElementById(TOOL_BLOCK_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOOL_BLOCK_STYLE_ID;
  style.textContent = `
    .dpp-tool-block {
      margin-top: 8px;
    }
    .dpp-tool-block-header {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
      color: rgb(97, 102, 107);
      font-size: 14px;
      line-height: 20px;
    }
    .dpp-tool-block-header:hover {
      color: rgb(60, 65, 70);
    }
    .dpp-tool-block-icon {
      width: 16px;
      height: 16px;
      color: #4d6bfe;
      flex-shrink: 0;
    }
    .dpp-tool-block-title {
      font-weight: 500;
      color: inherit;
    }
    .dpp-tool-block-chevron {
      width: 12px;
      height: 12px;
      color: inherit;
      transition: transform 0.2s ease;
      margin-left: 2px;
    }
    .dpp-tool-block[data-collapsed="true"] .dpp-tool-block-chevron {
      transform: rotate(-90deg);
    }
    .dpp-tool-block-body {
      overflow: hidden;
      transition: max-height 0.25s ease, opacity 0.2s ease;
      max-height: 500px;
      opacity: 1;
      padding-left: 20px;
      margin-top: 6px;
    }
    .dpp-tool-block[data-collapsed="true"] .dpp-tool-block-body {
      max-height: 0;
      opacity: 0;
      margin-top: 0;
    }
    .dpp-tool-block-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 3px 0;
      font-size: 13px;
      color: rgb(64, 65, 79);
      line-height: 1.5;
    }
    .dpp-tool-block-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4d6bfe;
      flex-shrink: 0;
      margin-top: 7px;
    }
    .dpp-tool-block-item-text {
      flex: 1;
    }
    .dpp-tool-block-item-name {
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 12px;
      color: #4d6bfe;
    }
    .dpp-tool-block-item-status {
      color: #10b981;
      margin-left: 6px;
    }
    .dpp-tool-block-item-status.error {
      color: #ef4444;
    }
    @media (prefers-color-scheme: dark) {
      .dpp-tool-block-header { color: rgb(155, 160, 165); }
      .dpp-tool-block-header:hover { color: rgb(200, 205, 210); }
      .dpp-tool-block-item { color: rgb(200, 200, 200); }
    }
  `;
  document.head.appendChild(style);
}

function createToolBlockShell(options?: { id?: string; restoreId?: string; collapsed?: boolean }): HTMLElement {
  const block = document.createElement('div');
  if (options?.id) block.id = options.id;
  if (options?.restoreId) block.setAttribute('data-dpp-tool-key', options.restoreId);
  block.className = 'dpp-tool-block';
  block.setAttribute('data-collapsed', options?.collapsed ? 'true' : 'false');
  block.innerHTML = `
    <div class="dpp-tool-block-header">
      <svg class="dpp-tool-block-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
      <span class="dpp-tool-block-title"></span>
      <svg class="dpp-tool-block-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="dpp-tool-block-body"></div>
  `;

  block.querySelector('.dpp-tool-block-header')!.addEventListener('click', () => {
    const collapsed = block.getAttribute('data-collapsed') === 'true';
    block.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
  });

  return block;
}

function updateToolBlockContent(block: HTMLElement, executions: ToolExecutionRecord[]) {
  const count = executions.length;
  const title = block.querySelector('.dpp-tool-block-title')!;
  title.textContent = `已执行工具（${count}次）`;

  const body = block.querySelector('.dpp-tool-block-body')!;
  body.innerHTML = '';
  for (const exec of executions) {
    const item = document.createElement('div');
    item.className = 'dpp-tool-block-item';
    item.innerHTML = `
      <div class="dpp-tool-block-dot"></div>
      <div class="dpp-tool-block-item-text">
        <span class="dpp-tool-block-item-name"></span>
        <span class="dpp-tool-block-item-status ${exec.result.ok ? '' : 'error'}"></span>
      </div>
    `;
    const nameEl = item.querySelector('.dpp-tool-block-item-name')!;
    const statusEl = item.querySelector('.dpp-tool-block-item-status')!;
    nameEl.textContent = exec.name;
    statusEl.textContent = `${exec.result.summary}${exec.result.detail ? ' · ' + exec.result.detail : ''}`;
    body.appendChild(item);
  }
}

function renderToolBlock() {
  injectToolBlockStyles();

  if (!toolBlockEl) {
    toolBlockEl = createToolBlockShell({ id: TOOL_BLOCK_ID });
    placeToolBlock(toolBlockEl);
  }

  cleanRenderedToolCalls();
  updateToolBlockContent(toolBlockEl, toolExecutions);
}

function scheduleRenderRestoredToolBlocks() {
  if (restoredRenderTimer) return;

  restoredRenderTimer = setTimeout(() => {
    restoredRenderTimer = null;
    const missing = renderRestoredToolBlocks();
    if (missing > 0 && restoredRenderAttempts < 20) {
      restoredRenderAttempts++;
      scheduleRenderRestoredToolBlocks();
      return;
    }
    restoredRenderAttempts = 0;
  }, restoredRenderAttempts === 0 ? 0 : 250);
}

function renderRestoredToolBlocks(): number {
  injectToolBlockStyles();

  const messages = getAssistantMessages();
  if (messages.length === 0) return restoredToolRecords.size;

  let missing = 0;
  const usedMessages = new Set<Element>();

  for (const record of restoredToolRecords.values()) {
    if (findRestoredToolBlock(record.id)) continue;

    const target = findRestoredToolTarget(record, messages, usedMessages);
    if (!target) {
      missing++;
      continue;
    }

    const executions = getRestoredExecutions(record);
    if (executions.length === 0) continue;

    const block = createToolBlockShell({ restoreId: record.id, collapsed: false });
    updateToolBlockContent(block, executions);
    appendToolBlockToMessage(target, block);
    usedMessages.add(target);
  }

  cleanRenderedToolCalls();
  return missing;
}

function findRestoredToolBlock(id: string): Element | null {
  for (const block of document.querySelectorAll('.dpp-tool-block[data-dpp-tool-key]')) {
    if (block.getAttribute('data-dpp-tool-key') === id) return block;
  }
  return null;
}

function getRestoredExecutions(record: ToolCallRestoreRecord): ToolExecutionRecord[] {
  if (record.executions?.length) return record.executions;
  return (record.calls ?? []).map((call) => ({
    name: call.name,
    result: summarizeRestoredToolCall(call),
  }));
}

function summarizeRestoredToolCall(call: ToolCall): ToolCardResult {
  const payload = call.payload as Record<string, unknown>;
  const detail = String(payload.name ?? payload.content ?? payload.id ?? '');

  switch (call.name) {
    case 'memory_save':
      return { ok: true, summary: '已保存', detail };
    case 'memory_update':
      return { ok: true, summary: '已更新', detail };
    case 'memory_delete':
      return { ok: true, summary: '已删除', detail };
    default:
      return { ok: true, summary: '已执行', detail };
  }
}

function getAssistantMessages(): Element[] {
  const messages = Array.from(document.querySelectorAll('.ds-message'));
  const assistantMessages = messages.filter((message) => message.querySelector('._74c0879'));
  return assistantMessages.length > 0 ? assistantMessages : messages;
}

function findRestoredToolTarget(
  record: ToolCallRestoreRecord,
  messages: Element[],
  usedMessages: Set<Element>,
): Element | null {
  const content = normalizeText(record.content);
  const snippet = content.slice(0, 80);
  const isSameUrl = record.url === getToolBlockUrl();

  if (snippet.length >= 12) {
    const matched = messages.find((message) => {
      if (usedMessages.has(message)) return false;
      return normalizeText(message.textContent ?? '').includes(snippet);
    });
    if (matched) return matched;
  }

  if (record.source === 'storage') {
    if (!isSameUrl) return null;
    return [...messages].reverse().find((message) => !usedMessages.has(message)) ?? null;
  }

  return messages.find((message) => !usedMessages.has(message)) ?? null;
}

function startRenderedToolCallCleaner() {
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      cleanRenderedToolCalls();
    });
  };

  schedule();

  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationMayContainToolMarker)) {
      schedule();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function mutationMayContainToolMarker(mutation: MutationRecord): boolean {
  if (mutation.type === 'characterData') {
    return containsToolMarker(mutation.target.textContent);
  }

  for (const node of mutation.addedNodes) {
    if (containsToolMarker(node.textContent)) {
      return true;
    }
  }

  return false;
}

function containsToolMarker(text: string | null | undefined): boolean {
  return typeof text === 'string' && TOOL_MARKER_RE.test(text);
}

function cleanRenderedToolCalls() {
  const roots = getToolCleanupRoots();
  for (const root of roots) {
    stripToolCallTextNodes(root);
  }
}

function getToolCleanupRoots(): Element[] {
  const roots = new Set<Element>();
  const activeMessage = toolBlockEl?.closest('.ds-message');
  if (activeMessage) roots.add(activeMessage);

  for (const block of document.querySelectorAll(`#${TOOL_BLOCK_ID}, .dpp-tool-block`)) {
    const message = block.closest('.ds-message');
    if (message) roots.add(message);
  }

  if (toolExecutions.length > 0) {
    const messages = document.querySelectorAll('.ds-message');
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && containsToolMarker(lastMessage.textContent)) {
      roots.add(lastMessage);
    }
  }

  return Array.from(roots);
}

function stripToolCallTextNodes(root: Element) {
  if (!containsToolMarker(root.textContent)) return;

  const textNodes: Text[] = [];
  const changedParents = new Set<HTMLElement>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (
        parent.closest('.dpp-tool-block') ||
        parent.closest('script, style, textarea, input, [contenteditable="true"]')
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  let activeTool: string | null = null;

  for (const textNode of textNodes) {
    const original = textNode.nodeValue ?? '';
    let cursor = 0;
    let next = '';

    while (cursor < original.length) {
      if (activeTool) {
        const closeRe = new RegExp(`<\\s*/\\s*${escapeRegExp(activeTool)}\\s*>`, 'i');
        const closeMatch = closeRe.exec(original.slice(cursor));
        if (!closeMatch) {
          cursor = original.length;
          break;
        }
        cursor += closeMatch.index + closeMatch[0].length;
        activeTool = null;
        continue;
      }

      const openMatch = TOOL_OPEN_TAG_RE.exec(original.slice(cursor));
      if (!openMatch) {
        next += original.slice(cursor);
        break;
      }

      next += original.slice(cursor, cursor + openMatch.index);
      activeTool = openMatch[1];
      cursor += openMatch.index + openMatch[0].length;
    }

    if (next !== original) {
      textNode.nodeValue = next;
      if (textNode.parentElement) changedParents.add(textNode.parentElement);
    }
  }

  for (const parent of changedParents) {
    pruneEmptyToolContainers(parent, root);
  }
}

function pruneEmptyToolContainers(start: HTMLElement, boundary: Element) {
  let el: HTMLElement | null = start;
  while (el && el !== boundary && !el.classList.contains('ds-message')) {
    const parent: HTMLElement | null = el.parentElement;
    const hasVisibleText = (el.textContent ?? '').trim().length > 0;
    const hasProtectedChild = Boolean(
      el.querySelector('.dpp-tool-block, img, svg, canvas, video, button, input, textarea'),
    );

    if (!hasVisibleText && !hasProtectedChild) {
      el.remove();
      el = parent;
      continue;
    }

    el = parent;
  }
}

function collapseToolBlock() {
  if (toolBlockEl) {
    setTimeout(() => {
      toolBlockEl?.setAttribute('data-collapsed', 'true');
    }, 1500);
  }
}

function appendToolBlockToMessage(message: Element, block: HTMLElement) {
  const responseContent = message.querySelector('._74c0879');
  if (responseContent) {
    responseContent.appendChild(block);
    return;
  }

  message.appendChild(block);
}

function placeToolBlock(block: HTMLElement) {
  const tryPlace = () => {
    // Find last assistant message container
    const messages = document.querySelectorAll('.ds-message');
    if (messages.length === 0) return false;

    const lastMsg = messages[messages.length - 1];
    appendToolBlockToMessage(lastMsg, block);
    return true;
  };

  if (!tryPlace()) {
    // DOM not ready yet — retry after a short delay
    const timer = setInterval(() => {
      if (tryPlace()) clearInterval(timer);
    }, 200);
    setTimeout(() => clearInterval(timer), 5000);
  }
}

// --- Background image feature (unchanged) ---

function getToolbarBottom(): number {
  const root = document.getElementById('root');
  if (!root) return 0;

  function walk(el: Element): number {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (
      rect.top >= -2 && rect.top <= 5 &&
      rect.height > 30 && rect.height <= 80 &&
      rect.width > 300 &&
      (style.position === 'absolute' || style.position === 'sticky' || style.position === 'fixed')
    ) {
      return rect.bottom;
    }
    for (const child of el.children) {
      const result = walk(child);
      if (result > 0) return result;
    }
    return 0;
  }

  return walk(root);
}

function hasVisibleBackground(style: CSSStyleDeclaration): boolean {
  const bg = style.backgroundColor;
  const bgImg = style.backgroundImage;
  return (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
         (bgImg !== 'none' && bgImg !== '');
}

function patchContainerBackgrounds() {
  if (!document.body.classList.contains('dpp-bg-active')) return;
  const root = document.getElementById('root');
  if (!root) return;

  const textarea = document.querySelector('textarea');
  if (!textarea) return;

  let inputBox: Element | null = null;
  let el: Element | null = textarea.parentElement;
  while (el && el !== root) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg === 'rgb(255, 255, 255)' || bg === 'rgb(249, 250, 251)') {
      inputBox = el;
      break;
    }
    el = el.parentElement;
  }

  if (!inputBox) return;

  el = inputBox.parentElement;
  while (el && el !== root && el !== document.body) {
    const style = getComputedStyle(el);
    if (hasVisibleBackground(style)) {
      (el as HTMLElement).setAttribute('data-dpp-transparent', '');
    }

    if (style.position === 'sticky') {
      for (const child of el.children) {
        if (child.contains(textarea)) continue;
        if (hasVisibleBackground(getComputedStyle(child))) {
          (child as HTMLElement).setAttribute('data-dpp-transparent', '');
        }
      }
    }

    el = el.parentElement;
  }
}

function removeBackground() {
  backgroundPatchObserver?.disconnect();
  backgroundPatchObserver = null;
  document.getElementById('dpp-bg')?.remove();
  document.getElementById('dpp-bg-style')?.remove();
  document.body.classList.remove('dpp-bg-active');
  document.body.style.removeProperty('--dpp-overlay-light');
  document.body.style.removeProperty('--dpp-overlay-dark');
  document.body.style.removeProperty('--dpp-blur');
}

function applyBackground(config: BackgroundConfig | null) {
  const normalizedConfig = normalizeBackgroundConfig(config);
  if (!normalizedConfig?.enabled) {
    removeBackground();
    return;
  }

  const imageUrl = (normalizedConfig.type === 'url' ? normalizedConfig.url : normalizedConfig.imageData) || null;

  if (!imageUrl) {
    removeBackground();
    return;
  }

  const existingBg = document.getElementById('dpp-bg');
  const existingStyle = document.getElementById('dpp-bg-style');

  document.body.classList.add('dpp-bg-active');

  const overlayAlpha = (1 - normalizedConfig.opacity).toFixed(3);
  const blurPx = ((1 - normalizedConfig.opacity) * 8).toFixed(1);
  document.body.style.setProperty('--dpp-overlay-light', `rgba(255, 255, 255, ${overlayAlpha})`);
  document.body.style.setProperty('--dpp-overlay-dark', `rgba(30, 30, 30, ${overlayAlpha})`);
  document.body.style.setProperty('--dpp-blur', `blur(${blurPx}px)`);

  const topOffset = getToolbarBottom();

  const bgDiv = existingBg || document.createElement('div');
  bgDiv.id = 'dpp-bg';
  Object.assign(bgDiv.style, {
    position: 'fixed',
    top: `${topOffset}px`,
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '-1',
    backgroundImage: `url("${imageUrl.replace(/[\\"]/g, '\\$&')}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    pointerEvents: 'none',
  });
  if (!existingBg) document.body.prepend(bgDiv);

  const styleEl = existingStyle || document.createElement('style');
  styleEl.id = 'dpp-bg-style';
  styleEl.textContent = `
    #dpp-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--dpp-overlay-light);
      backdrop-filter: var(--dpp-blur);
      -webkit-backdrop-filter: var(--dpp-blur);
      pointer-events: none;
    }

    body.dpp-bg-active,
    body.dpp-bg-active #root,
    body.dpp-bg-active #__next {
      background: transparent !important;
    }

    body.dpp-bg-active #root > div,
    body.dpp-bg-active #__next > div {
      background: transparent !important;
    }

    body.dpp-bg-active #root > div > div,
    body.dpp-bg-active #__next > div > div {
      background: transparent !important;
    }

    body.dpp-bg-active [data-dpp-transparent] {
      background: transparent !important;
    }

    @media (prefers-color-scheme: dark) {
      #dpp-bg::after {
        background: var(--dpp-overlay-dark);
      }
    }
  `;
  if (!existingStyle) document.head.appendChild(styleEl);

  patchContainerBackgrounds();

  // Re-patch on DOM changes
  backgroundPatchObserver?.disconnect();
  backgroundPatchObserver = new MutationObserver(() => {
    if (document.body.classList.contains('dpp-bg-active')) {
      patchContainerBackgrounds();
    }
  });
  backgroundPatchObserver.observe(document.body, { childList: true, subtree: true });
}
