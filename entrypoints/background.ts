import {
  getAllMemories,
  getMemoryById,
  saveMemory,
  updateMemory,
  deleteMemory,
  touchMemories,
  replaceAllMemories,
  archiveStaleMemories,
} from '../core/memory/store';
import { getAllSkills, saveSkill, deleteSkill, replaceAllCustomSkills } from '../core/skill/registry';
import {
  getAllPresets,
  savePreset,
  deletePreset,
  getActivePreset,
  setActivePresetId,
  replaceAllPresets,
} from '../core/preset/store';
import {
  appendAutomationRun,
  createAutomation,
  deleteAutomation,
  getAllAutomations,
  getAutomationById,
  getAutomationRunById,
  getAutomationRuns,
  setAutomationStatus,
  updateAutomation,
  updateAutomationRun,
} from '../core/automation/store';
import {
  AUTOMATION_WAKE_ALARM_NAME,
  AUTOMATION_WAKE_INTERVAL_MINUTES,
  refreshAutomationNextRunAt,
  runAutomation,
  scanDueAutomations,
} from '../core/automation/scheduler';
import {
  AUTOMATION_CONTENT_RUN,
  createAutomationRunnerFailure,
  isAutomationRunnerResult,
} from '../core/automation/messages';
import { getModelType, setModelType } from '../core/model/store';
import { getBackgroundConfig, saveBackgroundConfig, clearBackgroundConfig } from '../core/background/store';
import { getSyncConfig, saveSyncConfig } from '../core/sync/config';
import { webdavTest, webdavMkcol, webdavGet, webdavPut } from '../core/sync/webdav-client';
import { mergeMemories, mergeSkills, mergePresets } from '../core/sync/merge';
import type { BackgroundConfig, Memory, ModelType, NewMemory, Skill, SyncConfig, SystemPromptPreset } from '../core/types';
import type {
  AutomationCreateInput,
  AutomationRun,
  AutomationRunListOptions,
  AutomationRunUpdateInput,
  AutomationRunnerRequest,
  AutomationRunnerResult,
  AutomationStatus,
  AutomationTrigger,
  AutomationUpdateInput,
} from '../core/automation/types';

const DEEPSEEK_HOME_URL = 'https://chat.deepseek.com/';
const TAB_READY_TIMEOUT_MS = 20_000;
const CONTENT_BRIDGE_RETRY_MS = 15_000;
const CONTENT_BRIDGE_RETRY_STEP_MS = 500;

export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  archiveStaleMemories().catch(() => {});
  registerAutomationScheduler();
  scanDueAutomations(executeAutomationRun).then(handleAutomationScanResult).catch(() => {});

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  });
});

async function handleMessage(
  message: { type: string; payload?: unknown },
  sender: chrome.runtime.MessageSender,
) {
  switch (message.type) {
    case 'GET_MEMORIES':
      return getAllMemories();

    case 'GET_MEMORY_BY_ID': {
      const { id: memId } = message.payload as { id: number };
      return getMemoryById(memId) ?? null;
    }

    case 'SAVE_MEMORY': {
      const id = await saveMemory(message.payload as NewMemory);
      await broadcastStateUpdate(sender.tab?.id);
      return { id };
    }

    case 'UPDATE_MEMORY': {
      await updateMemory(message.payload as Memory);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_MEMORY': {
      const { id } = message.payload as { id: number };
      await deleteMemory(id);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'TOUCH_MEMORIES': {
      const { ids } = message.payload as { ids: number[] };
      await touchMemories(ids);
      return { ok: true };
    }

    case 'GET_SKILLS':
      return getAllSkills();

    case 'SAVE_SKILL': {
      await saveSkill(message.payload as Skill);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_SKILL': {
      const { name } = message.payload as { name: string };
      await deleteSkill(name);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_PRESETS':
      return getAllPresets();

    case 'SAVE_PRESET': {
      await savePreset(message.payload as SystemPromptPreset);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_PRESET': {
      const { id: presetId } = message.payload as { id: string };
      await deletePreset(presetId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_ACTIVE_PRESET': {
      const { id: activeId } = message.payload as { id: string | null };
      await setActivePresetId(activeId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_ACTIVE_PRESET':
      return getActivePreset();

    case 'GET_AUTOMATIONS':
      return getAllAutomations();

    case 'GET_AUTOMATION': {
      const { id } = message.payload as { id: string };
      return getAutomationById(id);
    }

    case 'CREATE_AUTOMATION': {
      const automation = await createAutomation(message.payload as AutomationCreateInput);
      const scheduled = await refreshAutomationNextRunAt(automation.id);
      await broadcastAutomationUpdate(sender.tab?.id);
      return scheduled ?? automation;
    }

    case 'UPDATE_AUTOMATION': {
      const { id, patch } = message.payload as { id: string; patch: AutomationUpdateInput };
      const automation = await updateAutomation(id, patch);
      const scheduled = automation ? await refreshAutomationNextRunAt(automation.id) : null;
      await broadcastAutomationUpdate(sender.tab?.id);
      return scheduled ?? automation;
    }

    case 'DELETE_AUTOMATION': {
      const { id } = message.payload as { id: string };
      await deleteAutomation(id);
      await broadcastAutomationUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_AUTOMATION_STATUS': {
      const { id, status } = message.payload as { id: string; status: AutomationStatus };
      const automation = await setAutomationStatus(id, status);
      const scheduled = automation ? await refreshAutomationNextRunAt(automation.id) : null;
      await broadcastAutomationUpdate(sender.tab?.id);
      return scheduled ?? automation;
    }

    case 'RUN_AUTOMATION_NOW': {
      const { id } = message.payload as { id: string };
      const run = await runAutomation({
        automationId: id,
        trigger: 'manual',
        scheduledFor: null,
        executor: executeAutomationRun,
      });
      await broadcastAutomationUpdate(sender.tab?.id);
      await broadcastAutomationRunUpdate(sender.tab?.id);
      return run ?? { ok: false, error: 'automation_already_running' };
    }

    case 'GET_AUTOMATION_RUNS':
      return getAutomationRuns(message.payload as AutomationRunListOptions);

    case 'GET_AUTOMATION_RUN': {
      const { id } = message.payload as { id: string };
      return getAutomationRunById(id);
    }

    case 'APPEND_AUTOMATION_RUN': {
      await appendAutomationRun(message.payload as AutomationRun);
      await broadcastAutomationRunUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'UPDATE_AUTOMATION_RUN': {
      const { id, patch } = message.payload as { id: string; patch: AutomationRunUpdateInput };
      const run = await updateAutomationRun(id, patch);
      await broadcastAutomationRunUpdate(sender.tab?.id);
      return run;
    }

    case 'GET_CONFIG':
      return { version: '0.1.0' };

    case 'GET_MODEL_TYPE':
      return getModelType();

    case 'SET_MODEL_TYPE': {
      const newModelType = message.payload as ModelType;
      const current = await getModelType();
      if (newModelType === current) return { ok: true };
      await setModelType(newModelType);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_BACKGROUND':
      return getBackgroundConfig();

    case 'SAVE_BACKGROUND': {
      const bgConfig = message.payload as BackgroundConfig;
      await saveBackgroundConfig(bgConfig);
      await broadcastBackgroundUpdate(bgConfig);
      return { ok: true };
    }

    case 'CLEAR_BACKGROUND': {
      await clearBackgroundConfig();
      await broadcastBackgroundUpdate(null);
      return { ok: true };
    }

    case 'GET_SYNC_CONFIG':
      return getSyncConfig();

    case 'SAVE_SYNC_CONFIG': {
      await saveSyncConfig(message.payload as SyncConfig);
      return { ok: true };
    }

    case 'WEBDAV_TEST': {
      await webdavTest(message.payload as SyncConfig);
      return { ok: true };
    }

    case 'WEBDAV_SYNC': {
      const config = await getSyncConfig();
      if (!config) throw new Error('未配置 WebDAV');

      await webdavMkcol(config);

      const [localMemories, allSkills, localPresets] = await Promise.all([
        getAllMemories(),
        getAllSkills(),
        getAllPresets(),
      ]);
      const localSkills = allSkills.filter((s) => s.source === 'custom');

      const [remoteMemJson, remoteSkillJson, remotePresetJson] = await Promise.all([
        webdavGet(config, 'memories.json'),
        webdavGet(config, 'skills.json'),
        webdavGet(config, 'presets.json'),
      ]);

      const remoteMemories: Memory[] = remoteMemJson ? JSON.parse(remoteMemJson) : [];
      const remoteSkills: Skill[] = remoteSkillJson ? JSON.parse(remoteSkillJson) : [];
      const remotePresets: SystemPromptPreset[] = remotePresetJson ? JSON.parse(remotePresetJson) : [];

      const mergedMemories = mergeMemories(localMemories, remoteMemories);
      const mergedSkills = mergeSkills(localSkills, remoteSkills);
      const mergedPresets = mergePresets(localPresets, remotePresets);

      await Promise.all([
        replaceAllMemories(mergedMemories),
        replaceAllCustomSkills(mergedSkills),
        replaceAllPresets(mergedPresets),
      ]);

      await Promise.all([
        webdavPut(config, 'memories.json', JSON.stringify(mergedMemories)),
        webdavPut(config, 'skills.json', JSON.stringify(mergedSkills)),
        webdavPut(config, 'presets.json', JSON.stringify(mergedPresets)),
      ]);

      const now = Date.now();
      await saveSyncConfig({ ...config, lastSyncAt: now });
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true, lastSyncAt: now };
    }

    default:
      return null;
  }
}

async function broadcastToTabs(payload: Record<string, unknown>, excludeTabId?: number) {
  chrome.runtime.sendMessage(payload).catch(() => {});

  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
  for (const tab of tabs) {
    if (tab.id && tab.id !== excludeTabId) {
      chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
    }
  }
  if (excludeTabId) {
    chrome.tabs.sendMessage(excludeTabId, payload).catch(() => {});
  }
}

async function broadcastStateUpdate(excludeTabId?: number) {
  const [memories, skills, activePreset, modelType] = await Promise.all([
    getAllMemories(),
    getAllSkills(),
    getActivePreset(),
    getModelType(),
  ]);
  await broadcastToTabs({ type: 'STATE_UPDATED', memories, skills, activePreset, modelType }, excludeTabId);
}

async function broadcastBackgroundUpdate(config: BackgroundConfig | null) {
  await broadcastToTabs({ type: 'BACKGROUND_UPDATED', config });
}

async function broadcastAutomationUpdate(excludeTabId?: number) {
  const automations = await getAllAutomations();
  await broadcastToTabs({ type: 'AUTOMATIONS_UPDATED', automations }, excludeTabId);
}

async function broadcastAutomationRunUpdate(excludeTabId?: number) {
  await broadcastToTabs({ type: 'AUTOMATION_RUNS_UPDATED' }, excludeTabId);
}

function registerAutomationScheduler() {
  chrome.alarms
    .create(AUTOMATION_WAKE_ALARM_NAME, { periodInMinutes: AUTOMATION_WAKE_INTERVAL_MINUTES })
    .catch(() => {});

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTOMATION_WAKE_ALARM_NAME) return;
    scanDueAutomations(executeAutomationRun).then(handleAutomationScanResult).catch(() => {});
  });
}

async function handleAutomationScanResult(result: { initialized: number; started: number; failed: number }) {
  if (result.initialized === 0 && result.started === 0 && result.failed === 0) return;
  await broadcastAutomationUpdate();
  await broadcastAutomationRunUpdate();
}

async function executeAutomationRun(request: AutomationRunnerRequest): Promise<AutomationRunnerResult> {
  const tab = await getAutomationExecutionTab(request.trigger);
  if (!tab?.id) {
    return createAutomationRunnerFailure(
      request,
      'automation_deepseek_tab_not_found',
      'No DeepSeek tab is available for automation execution.',
      'tab',
      true,
    );
  }

  try {
    const response = await sendAutomationRunToTab(tab.id, request);
    if (isAutomationRunnerResult(response)) {
      if (response.ok && request.trigger === 'manual' && response.sessionUrl) {
        await chrome.tabs.update(tab.id, { url: response.sessionUrl, active: true }).catch(() => undefined);
      }
      return response;
    }
    return createAutomationRunnerFailure(
      request,
      'automation_bridge_invalid_response',
      'DeepSeek content bridge returned an invalid automation response.',
      'bridge',
      true,
    );
  } catch (err) {
    return createAutomationRunnerFailure(
      request,
      'automation_content_bridge_unavailable',
      err instanceof Error ? err.message : String(err),
      'bridge',
      true,
    );
  }
}

async function getAutomationExecutionTab(trigger: AutomationTrigger): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ url: '*://chat.deepseek.com/*' });
  const existing = tabs.find((item) => typeof item.id === 'number');
  if (existing?.id) {
    if (trigger === 'manual') {
      await chrome.tabs.update(existing.id, { active: true }).catch(() => undefined);
    }
    await waitForTabReady(existing.id);
    return existing;
  }

  const tab = await chrome.tabs.create({
    url: DEEPSEEK_HOME_URL,
    active: trigger === 'manual',
  });
  if (!tab.id) return null;
  await waitForTabReady(tab.id);
  return tab;
}

async function sendAutomationRunToTab(
  tabId: number,
  request: AutomationRunnerRequest,
): Promise<unknown> {
  const deadline = Date.now() + CONTENT_BRIDGE_RETRY_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      return await chrome.tabs.sendMessage(tabId, {
        type: AUTOMATION_CONTENT_RUN,
        payload: request,
      });
    } catch (err) {
      lastError = err;
      await delay(CONTENT_BRIDGE_RETRY_STEP_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('DeepSeek content bridge is unavailable.');
}

async function waitForTabReady(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.status === 'complete') {
    await delay(500);
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, TAB_READY_TIMEOUT_MS);
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      done();
    };

    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
  await delay(500);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
