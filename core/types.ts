import type {
  AutomationCreateInput,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  AutomationRunListOptions,
  AutomationRunUpdateInput,
  AutomationStatus,
  AutomationUpdateInput,
} from './automation/types';

export type MemoryType = 'user' | 'feedback' | 'topic' | 'reference';

export type ModelType = 'expert' | null;

export interface BackgroundConfig {
  enabled: boolean;
  type: 'upload' | 'url';
  url?: string;
  imageData?: string;
  opacity: number;
}

export interface Memory {
  id?: number;
  syncId: string;
  type: MemoryType;
  name: string;
  content: string;
  description: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

export type NewMemory = Omit<
  Memory,
  'id' | 'syncId' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'
> & {
  syncId?: string;
};

export interface SyncConfig {
  url: string;
  username: string;
  password: string;
  remotePath: string;
  lastSyncAt: number | null;
}

export type SkillSource = 'builtin' | 'custom';

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
  memoryEnabled: boolean;
  metadata?: Record<string, string>;
}

export interface SkillInvocation {
  skillName: string;
  args: string;
  rawInput: string;
}

export interface ToolCall {
  name: string;
  payload: Record<string, unknown>;
  raw: string;
}

export interface ToolCardResult {
  ok: boolean;
  summary: string;
  detail?: string;
}

export interface ToolExecutionRecord {
  name: string;
  result: ToolCardResult;
}

export interface ToolCallRestoreRecord {
  id: string;
  calls?: ToolCall[];
  executions?: ToolExecutionRecord[];
  content?: string;
  source?: 'history' | 'storage';
  url?: string;
  createdAt?: number;
}

export interface SystemPromptPreset {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeepSeekRequest {
  chat_session_id: string;
  model_type: string;
  parent_message_id: number | null;
  preempt: boolean;
  prompt: string;
  ref_file_ids: string[];
  search_enabled: boolean;
  thinking_enabled: boolean;
  action?: string;
}

export interface SSEEvent {
  id?: string;
  type: string;
  data: string;
}

export type MessageAction =
  | { type: 'GET_MEMORIES' }
  | { type: 'GET_MEMORY_BY_ID'; payload: { id: number } }
  | { type: 'GET_SKILLS' }
  | { type: 'SAVE_MEMORY'; payload: NewMemory }
  | { type: 'DELETE_MEMORY'; payload: { id: number } }
  | { type: 'UPDATE_MEMORY'; payload: Memory }
  | { type: 'SAVE_SKILL'; payload: Skill }
  | { type: 'DELETE_SKILL'; payload: { name: string } }
  | { type: 'GET_PRESETS' }
  | { type: 'SAVE_PRESET'; payload: SystemPromptPreset }
  | { type: 'DELETE_PRESET'; payload: { id: string } }
  | { type: 'SET_ACTIVE_PRESET'; payload: { id: string | null } }
  | { type: 'GET_ACTIVE_PRESET' }
  | { type: 'GET_AUTOMATIONS' }
  | { type: 'GET_AUTOMATION'; payload: { id: AutomationId } }
  | { type: 'CREATE_AUTOMATION'; payload: AutomationCreateInput }
  | { type: 'UPDATE_AUTOMATION'; payload: { id: AutomationId; patch: AutomationUpdateInput } }
  | { type: 'DELETE_AUTOMATION'; payload: { id: AutomationId } }
  | { type: 'SET_AUTOMATION_STATUS'; payload: { id: AutomationId; status: AutomationStatus } }
  | { type: 'RUN_AUTOMATION_NOW'; payload: { id: AutomationId } }
  | { type: 'GET_AUTOMATION_RUNS'; payload: AutomationRunListOptions }
  | { type: 'GET_AUTOMATION_RUN'; payload: { id: AutomationRunId } }
  | { type: 'APPEND_AUTOMATION_RUN'; payload: AutomationRun }
  | { type: 'UPDATE_AUTOMATION_RUN'; payload: { id: AutomationRunId; patch: AutomationRunUpdateInput } }
  | { type: 'GET_CONFIG' }
  | { type: 'GET_MODEL_TYPE' }
  | { type: 'SET_MODEL_TYPE'; payload: ModelType }
  | { type: 'TOOL_CALL_EXECUTED'; payload: ToolCall }
  | { type: 'MEMORIES_UPDATED' }
  | { type: 'WEBDAV_TEST'; payload: Omit<SyncConfig, 'lastSyncAt'> }
  | { type: 'WEBDAV_SYNC' }
  | { type: 'GET_SYNC_CONFIG' }
  | { type: 'SAVE_SYNC_CONFIG'; payload: SyncConfig }
  | { type: 'GET_BACKGROUND' }
  | { type: 'SAVE_BACKGROUND'; payload: BackgroundConfig }
  | { type: 'CLEAR_BACKGROUND' };

export interface PromptConfig {
  memoryTokenBudget: number;
  systemTemplate: string;
}
