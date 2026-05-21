import { useEffect, useMemo, useState } from 'react';
import type {
  Automation,
  AutomationCreateInput,
  AutomationPromptOptions,
  AutomationRun,
  AutomationSchedule,
  AutomationScheduleKind,
} from '../../../core/automation/types';
import { validateAutomationSchedule } from '../../../core/automation/schedule';

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';

const DEFAULT_PROMPT_OPTIONS: AutomationPromptOptions = {
  modelType: null,
  searchEnabled: false,
  thinkingEnabled: false,
  refFileIds: [],
};

type FormState = {
  name: string;
  prompt: string;
  scheduleKind: AutomationScheduleKind;
  expression: string;
  timezone: string;
  modelType: string;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  prompt: '',
  scheduleKind: 'manual',
  expression: '',
  timezone: DEFAULT_TIMEZONE,
  modelType: '',
  searchEnabled: false,
  thinkingEnabled: false,
};

export default function AutomationPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Record<string, AutomationRun[]>>({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');

  const activeCount = useMemo(
    () => automations.filter((item) => item.status === 'active').length,
    [automations],
  );

  const load = async () => {
    const list: Automation[] = await chrome.runtime.sendMessage({ type: 'GET_AUTOMATIONS' });
    const items = list ?? [];
    setAutomations(items);
    const runEntries = await Promise.all(
      items.map(async (automation) => {
        const recent: AutomationRun[] = await chrome.runtime.sendMessage({
          type: 'GET_AUTOMATION_RUNS',
          payload: { automationId: automation.id, limit: 3 },
        });
        return [automation.id, recent ?? []] as const;
      }),
    );
    setRuns(Object.fromEntries(runEntries));
  };

  useEffect(() => {
    void load();

    const handleUpdate = (msg: { type?: string; automations?: Automation[] }) => {
      if (msg.type === 'AUTOMATIONS_UPDATED' || msg.type === 'AUTOMATION_RUNS_UPDATED') {
        void load();
      }
      if (msg.type === 'AUTOMATIONS_UPDATED' && Array.isArray(msg.automations)) {
        setAutomations(msg.automations);
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMessage('');
    setShowForm((prev) => !prev);
  };

  const startEdit = (automation: Automation) => {
    setEditing(automation);
    setForm(fromAutomation(automation));
    setMessage('');
    setShowForm(true);
  };

  const save = async () => {
    const payload = toAutomationInput(form);
    if (!payload.name || !payload.prompt) {
      setMessage('名称和 Prompt 不能为空');
      return;
    }
    if (payload.schedule.enabled && !payload.schedule.expression) {
      setMessage('请填写定时表达式');
      return;
    }
    const scheduleValidation = validateAutomationSchedule(payload.schedule);
    if (!scheduleValidation.ok) {
      setMessage(scheduleValidation.error.message);
      return;
    }

    const response = editing
      ? await chrome.runtime.sendMessage({
        type: 'UPDATE_AUTOMATION',
        payload: { id: editing.id, patch: payload },
      })
      : await chrome.runtime.sendMessage({ type: 'CREATE_AUTOMATION', payload });

    if (response?.ok === false && response.error) {
      setMessage(typeof response.error === 'string' ? response.error : response.error.message);
      return;
    }

    if (response?.lastError) {
      setMessage(response.lastError.message);
      return;
    } else {
      setMessage('');
    }
    setShowForm(false);
    setEditing(null);
    await load();
  };

  const runNow = async (id: string) => {
    setRunningIds((prev) => new Set(prev).add(id));
    setMessage('');
    try {
      const run: AutomationRun | { ok: false; error: string } | null = await chrome.runtime.sendMessage({
        type: 'RUN_AUTOMATION_NOW',
        payload: { id },
      });
      if (run && 'error' in run && typeof run.error === 'string') {
        setMessage(run.error);
      } else if (run && 'status' in run && (run.status === 'failed' || run.status === 'timeout')) {
        setMessage(run.error?.message ?? '运行失败');
      }
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await load();
    }
  };

  const toggleStatus = async (automation: Automation) => {
    await chrome.runtime.sendMessage({
      type: 'SET_AUTOMATION_STATUS',
      payload: { id: automation.id, status: automation.status === 'active' ? 'paused' : 'active' },
    });
    await load();
  };

  const remove = async (automation: Automation) => {
    if (!confirm(`删除自动化「${automation.name}」？`)) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_AUTOMATION', payload: { id: automation.id } });
    await load();
  };

  const openSession = async (url: string | null) => {
    if (!url) return;
    await chrome.tabs.create({ url, active: true });
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
            自动化
          </h2>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
            {automations.length} 个任务，{activeCount} 个启用
          </div>
        </div>
        <button
          onClick={startCreate}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          新建
        </button>
      </div>

      {message && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <AutomationForm
            form={form}
            editing={editing}
            onChange={setForm}
            onSave={save}
            onCancel={() => { setShowForm(false); setEditing(null); setMessage(''); }}
          />
        </div>
      )}

      {automations.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--ds-surface)' }}>
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: 'var(--ds-text-tertiary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>暂无自动化</p>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              runs={runs[automation.id] ?? []}
              running={runningIds.has(automation.id)}
              onRun={() => runNow(automation.id)}
              onToggleStatus={() => toggleStatus(automation)}
              onEdit={() => startEdit(automation)}
              onDelete={() => remove(automation)}
              onOpenSession={() => openSession(automation.deepseek.sessionUrl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationForm({
  form,
  editing,
  onChange,
  onSave,
  onCancel,
}: {
  form: FormState;
  editing: Automation | null;
  onChange: (form: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange({ ...form, [key]: value });
  };
  const isScheduled = form.scheduleKind !== 'manual';

  return (
    <div className="ds-form rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>名称</span>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
            placeholder="任务名称"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>模型</span>
          <select
            value={form.modelType}
            onChange={(e) => update('modelType', e.target.value)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          >
            <option value="">默认</option>
            <option value="expert">Expert</option>
            <option value="vision">Vision</option>
          </select>
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>Prompt</span>
        <textarea
          value={form.prompt}
          onChange={(e) => update('prompt', e.target.value)}
          className="ds-input w-full px-3 py-2 text-xs rounded-lg min-h-28 resize-y"
          placeholder="输入要定时发送到 DeepSeek 的内容"
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>触发</span>
          <select
            value={form.scheduleKind}
            onChange={(e) => update('scheduleKind', e.target.value as AutomationScheduleKind)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          >
            <option value="manual">手动</option>
            <option value="cron">Cron</option>
            <option value="rrule">RRULE</option>
          </select>
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>表达式</span>
          <input
            value={isScheduled ? form.expression : ''}
            onChange={(e) => update('expression', e.target.value)}
            disabled={!isScheduled}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg disabled:opacity-50"
            placeholder={form.scheduleKind === 'rrule' ? 'FREQ=HOURLY;INTERVAL=1' : '0 9 * * *'}
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>时区</span>
        <input
          value={form.timezone}
          onChange={(e) => update('timezone', e.target.value)}
          className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          placeholder="Asia/Shanghai"
        />
      </label>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
          <input
            type="checkbox"
            checked={form.searchEnabled}
            onChange={(e) => update('searchEnabled', e.target.checked)}
          />
          联网
        </label>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
          <input
            type="checkbox"
            checked={form.thinkingEnabled}
            onChange={(e) => update('thinkingEnabled', e.target.checked)}
          />
          深度思考
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg">
          取消
        </button>
        <button onClick={onSave} className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg">
          {editing ? '保存' : '创建'}
        </button>
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  runs,
  running,
  onRun,
  onToggleStatus,
  onEdit,
  onDelete,
  onOpenSession,
}: {
  automation: Automation;
  runs: AutomationRun[];
  running: boolean;
  onRun: () => void;
  onToggleStatus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession: () => void;
}) {
  const latestRun = runs[0];
  const statusColor = automation.status === 'active' ? 'var(--ds-success)' : 'var(--ds-text-tertiary)';
  const statusBg = automation.status === 'active' ? 'var(--ds-success-bg)' : 'var(--ds-surface)';

  return (
    <div className="ds-card rounded-xl p-3 space-y-2 animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[13px] font-medium truncate" style={{ color: 'var(--ds-text)' }}>
              {automation.name}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: statusColor, background: statusBg }}>
              {automation.status === 'active' ? '启用' : '暂停'}
            </span>
          </div>
          <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--ds-text-secondary)' }}>
            {automation.prompt}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton title={automation.status === 'active' ? '暂停' : '启用'} path={automation.status === 'active' ? 'M10 9v6m4-6v6' : 'M5 3l14 9-14 9V3z'} onClick={onToggleStatus} />
          <IconButton title="编辑" path="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" onClick={onEdit} />
          <IconButton title="删除" path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-9 0h12" onClick={onDelete} danger />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Meta label="下次" value={formatTime(automation.nextRunAt)} />
        <Meta label="上次" value={formatTime(automation.lastRunAt)} />
        <Meta label="会话" value={automation.deepseek.chatSessionId ? shortId(automation.deepseek.chatSessionId) : '未创建'} />
        <Meta label="最近" value={latestRun ? formatRun(latestRun) : '暂无'} />
      </div>

      {automation.lastError && (
        <div className="rounded-lg px-2.5 py-2 text-[11px]" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}>
          {automation.lastError.message}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onOpenSession}
          disabled={!automation.deepseek.sessionUrl}
          className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
        >
          打开会话
        </button>
        <button
          onClick={onRun}
          disabled={running}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-60"
        >
          {running ? '运行中' : '立即运行'}
        </button>
      </div>
    </div>
  );
}

function IconButton({
  title,
  path,
  onClick,
  danger,
}: {
  title: string;
  path: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`ds-action-btn w-7 h-7 rounded-lg flex items-center justify-center ${danger ? 'ds-action-btn-delete' : 'ds-action-btn-edit'}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--ds-surface)' }}>
      <div style={{ color: 'var(--ds-text-tertiary)' }}>{label}</div>
      <div className="truncate mt-0.5" style={{ color: 'var(--ds-text-secondary)' }}>{value}</div>
    </div>
  );
}

function fromAutomation(automation: Automation): FormState {
  return {
    name: automation.name,
    prompt: automation.prompt,
    scheduleKind: automation.schedule.kind,
    expression: automation.schedule.expression ?? '',
    timezone: automation.schedule.timezone || DEFAULT_TIMEZONE,
    modelType: normalizeFormModelType(automation.promptOptions.modelType),
    searchEnabled: automation.promptOptions.searchEnabled,
    thinkingEnabled: automation.promptOptions.thinkingEnabled,
  };
}

function toAutomationInput(form: FormState): AutomationCreateInput {
  const schedule = buildSchedule(form);
  return {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    schedule,
    promptOptions: {
      ...DEFAULT_PROMPT_OPTIONS,
      modelType: form.modelType.trim() || null,
      searchEnabled: form.searchEnabled,
      thinkingEnabled: form.thinkingEnabled,
    },
  };
}

function buildSchedule(form: FormState): AutomationSchedule {
  const enabled = form.scheduleKind !== 'manual';
  return {
    kind: form.scheduleKind,
    expression: enabled ? form.expression.trim() : null,
    timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
    enabled,
    minimumIntervalMinutes: 15,
  };
}

function formatTime(value: number | null): string {
  if (!value) return '暂无';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRun(run: AutomationRun): string {
  const label: Record<AutomationRun['status'], string> = {
    queued: '排队中',
    running: '运行中',
    succeeded: '成功',
    failed: '失败',
    timeout: '超时',
    cancelled: '已取消',
    skipped: '已跳过',
  };
  return `${label[run.status]}${run.attempt > 1 ? ` · ${run.attempt}次` : ''}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function normalizeFormModelType(modelType: string | null): string {
  if (!modelType || modelType === 'default' || modelType === 'DEFAULT' || modelType === 'chat' || modelType === 'deepseek_chat') {
    return '';
  }
  if (modelType === 'reasoner' || modelType === 'deepseek_reasoner') return 'expert';
  if (modelType === 'expert' || modelType === 'vision') return modelType;
  return '';
}
