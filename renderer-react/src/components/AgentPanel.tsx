import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Models } from 'appwrite';
import { DiffEditor } from '@monaco-editor/react';
import { Bot, Check, ChevronDown, LoaderCircle, Play, Send, Settings2, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';

import {
  createAgentSystemPrompt,
  createDefaultAgentSettings,
  createUserPrompt,
  createWorkspaceContextMessage,
  loadAgentSettings,
  pruneConversation,
  requestAgentCompletion,
  saveAgentSettings,
  type AgentChatMessage,
  type AgentSettings,
  type AgentUiMessage,
} from '@/lib/agent';
import { hasAgentCloudConfiguration } from '@/lib/config';
import { joinPath, safeJsonParse } from '@/lib/utils';
import type { AgentApprovalRequest, AgentApprovalResolution, AgentToolInvokeResponse, AgentToolName } from '@/types/electron';

import { MarkdownRenderer } from './MarkdownRenderer';
import { Modal } from './Modal';

type AgentPanelProps = {
  user: Models.User<Models.Preferences>;
  workspacePath: string | null;
  activeTab: {
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
  } | null;
  onFileContentApplied: (filePath: string, content: string) => void;
  onPathDeleted: (filePath: string, isDirectory: boolean) => void;
  onRefreshWorkspace: () => void;
  pushConsole: (message: string, level?: 'info' | 'success' | 'error') => void;
  pushToast: (message: string, tone?: 'info' | 'success' | 'error') => void;
};

type PendingApprovalState = {
  toolCallId: string;
  toolName: AgentToolName;
  request: AgentApprovalRequest;
};

const INITIAL_MESSAGE: AgentUiMessage = {
  id: 'agent-welcome',
  role: 'assistant',
  content:
    'Ask me to inspect the workspace, explain code, or prepare changes. I will pause for approval before writing files, deleting paths, or running commands.',
};

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatToolResponse(response: Extract<AgentToolInvokeResponse, { success: true }>) {
  if ('output' in response) {
    return response.output;
  }

  return null;
}

export function AgentPanel({
  user,
  workspacePath,
  activeTab,
  onFileContentApplied,
  onPathDeleted,
  onRefreshWorkspace,
  pushConsole,
  pushToast,
}: AgentPanelProps) {
  const [messages, setMessages] = useState<AgentUiMessage[]>([INITIAL_MESSAGE]);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [settings, setSettings] = useState<AgentSettings>(() => createDefaultAgentSettings());
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApprovalState | null>(null);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  const conversationRef = useRef<AgentChatMessage[]>([]);
  const workspaceRevisionRef = useRef<number | null>(null);
  const workspaceMessageRef = useRef<string>('No workspace is open.');
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const deferredPrompt = useDeferredValue(draftPrompt);

  const hasCloudAgent = hasAgentCloudConfiguration();
  const canSend = Boolean(workspacePath) && !busy && !pendingApproval && deferredPrompt.trim().length > 0;
  const pendingPreview = pendingApproval?.request.preview ?? null;

  const providerLabel = useMemo(() => {
    switch (settings.apiProvider) {
      case 'groq':
        return 'Groq';
      case 'openrouter':
        return 'OpenRouter';
      default:
        return 'Appwrite default';
    }
  }, [settings.apiProvider]);

  function appendUiMessage(message: AgentUiMessage) {
    startTransition(() => {
      setMessages((current) => [...current, message]);
    });
  }

  function syncToolSideEffects(resolution: { meta?: Record<string, unknown>; output: string }) {
    const action = typeof resolution.meta?.action === 'string' ? resolution.meta.action : '';
    const relativePath = typeof resolution.meta?.path === 'string' ? resolution.meta.path : '';

    if (action === 'command') {
      pushConsole(resolution.output, 'info');
      return;
    }

    if (!workspacePath || !relativePath) {
      return;
    }

    const targetPath = joinPath(workspacePath, relativePath);

    if (action === 'write' || action === 'create' || action === 'edit') {
      if (typeof resolution.meta?.content === 'string') {
        onFileContentApplied(targetPath, resolution.meta.content);
        onRefreshWorkspace();
      }
      return;
    }

    if (action === 'delete') {
      onPathDeleted(targetPath, Boolean(resolution.meta?.isDirectory));
      onRefreshWorkspace();
    }
  }

  function appendToolConversation(toolCallId: string, toolName: AgentToolName, content: string) {
    conversationRef.current = [
      ...conversationRef.current,
      {
        role: 'tool',
        name: toolName,
        tool_call_id: toolCallId,
        content,
      },
    ];
  }

  async function hydrateWorkspaceContext() {
    const result = await window.tantalum.agent.getContext();
    if (!result.success) {
      throw new Error(result.error);
    }

    if (workspaceRevisionRef.current !== result.revision) {
      workspaceRevisionRef.current = result.revision;
      workspaceMessageRef.current = createWorkspaceContextMessage(result.workspaceRoot, result.workspaceMap, result.revision);
    }
  }

  async function runAgentLoop() {
    setBusy(true);

    try {
      for (let step = 0; step < 8; step += 1) {
        await hydrateWorkspaceContext();

        const response = await requestAgentCompletion({
          settings,
          messages: [
            { role: 'system', content: createAgentSystemPrompt() },
            { role: 'system', content: workspaceMessageRef.current },
            ...pruneConversation(conversationRef.current),
          ],
        });

        const choice = response.choices?.[0];
        const assistantMessage = choice?.message;
        const assistantContent = typeof assistantMessage?.content === 'string' ? assistantMessage.content.trim() : '';
        const toolCalls = Array.isArray(assistantMessage?.tool_calls) ? assistantMessage.tool_calls : [];

        if (!assistantContent && toolCalls.length === 0) {
          throw new Error('The provider returned an empty completion.');
        }

        conversationRef.current = [
          ...conversationRef.current,
          {
            role: 'assistant',
            content: assistantContent,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
        ];

        if (assistantContent) {
          appendUiMessage({
            id: createMessageId('assistant'),
            role: 'assistant',
            content: assistantContent,
          });
        }

        if (toolCalls.length === 0) {
          return;
        }

        let shouldContinue = false;

        for (const toolCall of toolCalls) {
          const result = await window.tantalum.agent.invokeTool({
            toolName: toolCall.function.name,
            args: safeParseArgs(toolCall.function.arguments),
          });

          if (!result.success) {
            const errorMessage = `Tool ${toolCall.function.name} failed: ${result.error}`;
            appendToolConversation(toolCall.id, toolCall.function.name, errorMessage);
            appendUiMessage({
              id: createMessageId('tool'),
              role: 'tool',
              content: errorMessage,
              tone: 'error',
              toolName: toolCall.function.name,
            });
            shouldContinue = true;
            continue;
          }

          if ('requiresApproval' in result && result.requiresApproval) {
            setPendingApproval({
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              request: result.approval,
            });
            appendUiMessage({
              id: createMessageId('approval'),
              role: 'status',
              content: `${result.approval.summary}. Review it and choose approve or deny.`,
              tone: 'warning',
              toolName: toolCall.function.name,
            });

            if (result.approval.preview.kind === 'file') {
              setReviewModalOpen(true);
            }

            return;
          }

          const toolOutput = formatToolResponse(result) || '';
          appendToolConversation(toolCall.id, toolCall.function.name, toolOutput);
          appendUiMessage({
            id: createMessageId('tool'),
            role: 'tool',
            content: toolOutput,
            toolName: toolCall.function.name,
          });
          if ('output' in result) {
            syncToolSideEffects(result);
          }
          shouldContinue = true;
        }

        if (!shouldContinue) {
          return;
        }
      }

      appendUiMessage({
        id: createMessageId('status'),
        role: 'status',
        content: 'I stopped after several tool iterations to avoid looping. Ask me to continue if you want me to keep going.',
        tone: 'warning',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleApproval(approved: boolean) {
    if (!pendingApproval) {
      return;
    }

    setBusy(true);

    try {
      const resolution = await window.tantalum.agent.resolveApproval({
        requestId: pendingApproval.request.requestId,
        approved,
      });

      const toolContent = describeApprovalResolution(resolution, pendingApproval.toolName);
      appendToolConversation(pendingApproval.toolCallId, pendingApproval.toolName, toolContent);
      appendUiMessage({
        id: createMessageId('approval-result'),
        role: 'tool',
        content: toolContent,
        tone: resolution.success && resolution.approved ? 'success' : approved ? 'error' : 'warning',
        toolName: pendingApproval.toolName,
      });

      if (resolution.success && resolution.approved) {
        syncToolSideEffects(resolution);
      }

      setPendingApproval(null);
      setReviewModalOpen(false);
      await runAgentLoop();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to resolve the approval request.';
      pushToast(message, 'error');
      appendUiMessage({
        id: createMessageId('approval-error'),
        role: 'status',
        content: message,
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSendPrompt() {
    const prompt = draftPrompt.trim();
    if (!prompt) {
      return;
    }

    if (!workspacePath) {
      pushToast('Open a workspace before starting the copilot.', 'info');
      return;
    }

    if (pendingApproval) {
      pushToast('Resolve the pending approval before sending another prompt.', 'info');
      return;
    }

    setDraftPrompt('');
    appendUiMessage({
      id: createMessageId('user'),
      role: 'user',
      content: prompt,
    });

    conversationRef.current = [
      ...conversationRef.current,
      {
        role: 'user',
        content: createUserPrompt(prompt, activeTab),
      },
    ];

    try {
      await runAgentLoop();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The agent request failed.';
      appendUiMessage({
        id: createMessageId('error'),
        role: 'status',
        content: message,
        tone: 'error',
      });
      pushToast(message, 'error');
    }
  }

  async function handleSaveSettings() {
    if (!hasCloudAgent) {
      pushToast('Push the Appwrite tables and functions first, then save agent settings.', 'error');
      return;
    }

    setSavingSettings(true);
    try {
      const nextSettings = await saveAgentSettings(user.$id, settings);
      setSettings(nextSettings);
      setSettingsOpen(false);
      pushToast(`Agent settings saved for ${providerLabel}.`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to save agent settings.', 'error');
    } finally {
      setSavingSettings(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoadingSettings(true);
      try {
        if (!hasCloudAgent) {
          if (mounted) {
            setSettings(createDefaultAgentSettings());
          }
          return;
        }

        const resolved = await loadAgentSettings(user.$id);
        if (mounted) {
          setSettings(resolved);
        }
      } catch (error) {
        if (mounted) {
          appendUiMessage({
            id: createMessageId('settings-error'),
            role: 'status',
            content: error instanceof Error ? error.message : 'Unable to load agent settings.',
            tone: 'error',
          });
        }
      } finally {
        if (mounted) {
          setLoadingSettings(false);
        }
      }
    }

    void run();

    return () => {
      mounted = false;
    };
  }, [hasCloudAgent, user.$id]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }

    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [messages, pendingApproval]);

  return (
    <>
      <section className="agent-panel">
        <div className="agent-panel-header">
          <div>
            <p className="eyebrow">AI copilot</p>
            <h2>Agent Manager</h2>
          </div>
          <div className="agent-panel-actions">
            <button className="ghost-button compact" type="button" onClick={() => setSettingsOpen((current) => !current)}>
              <Settings2 size={14} />
              Settings
            </button>
            <button
              className="ghost-button compact"
              type="button"
              onClick={() => {
                conversationRef.current = [];
                setPendingApproval(null);
                setMessages([INITIAL_MESSAGE]);
              }}
            >
              <Trash2 size={14} />
              Clear
            </button>
          </div>
        </div>

        <div className="agent-status-strip">
          <span className="release-badge">
            <Bot size={14} />
            {providerLabel}
          </span>
          <span className="release-badge">
            <Sparkles size={14} />
            {workspacePath ? 'Workspace ready' : 'Open a workspace'}
          </span>
          {busy ? (
            <span className="release-badge">
              <LoaderCircle size={14} className="spin" />
              Thinking
            </span>
          ) : null}
        </div>

        {!hasCloudAgent ? (
          <div className="inline-banner inline-banner-warning agent-inline-banner">
            Push the updated Appwrite tables and functions before using the agent, or the settings and proxy flow will fail.
          </div>
        ) : null}

        {settingsOpen ? (
          <div className="agent-settings-card">
            <div className="agent-settings-grid">
              <label>
                Provider
                <select
                  value={settings.apiProvider}
                  disabled={loadingSettings || savingSettings}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      apiProvider: event.target.value as AgentSettings['apiProvider'],
                    }))
                  }
                >
                  <option value="appwrite-default">Appwrite default</option>
                  <option value="openrouter">OpenRouter key</option>
                  <option value="groq">Groq key</option>
                </select>
              </label>

              <label>
                Model
                <input
                  value={settings.model}
                  disabled={loadingSettings || savingSettings}
                  onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))}
                  placeholder={settings.apiProvider === 'appwrite-default' ? 'Optional: uses proxy default if empty' : 'Required model name'}
                />
              </label>

              {settings.apiProvider !== 'appwrite-default' ? (
                <label className="agent-settings-span">
                  API key
                  <input
                    type="password"
                    value={settings.apiKey}
                    disabled={loadingSettings || savingSettings}
                    onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder={settings.apiProvider === 'groq' ? 'gsk_...' : 'sk-or-...'}
                  />
                </label>
              ) : null}
            </div>

            <div className="agent-settings-footnote">
              {settings.apiProvider === 'appwrite-default'
                ? 'The default path sends requests through the Appwrite function so the renderer never sees your managed provider key.'
                : 'Your custom key is stored in Appwrite under your account and used directly from the renderer for requests.'}
            </div>

            <div className="form-actions">
              <button className="ghost-button compact" type="button" onClick={() => setSettingsOpen(false)}>
                <ChevronDown size={14} />
                Collapse
              </button>
              <button className="primary-button compact" type="button" disabled={savingSettings || loadingSettings} onClick={() => void handleSaveSettings()}>
                {savingSettings ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                Save settings
              </button>
            </div>
          </div>
        ) : null}

        <div ref={messageListRef} className="agent-message-list">
          {messages.map((message) => (
            <article key={message.id} className={`agent-message agent-message-${message.role} ${message.tone ? `agent-message-${message.tone}` : ''}`}>
              <div className="agent-message-meta">
                <span>{message.role === 'assistant' ? 'Copilot' : message.role === 'user' ? 'You' : message.toolName ? message.toolName : 'Status'}</span>
              </div>
              <div className="agent-message-body">
                {message.role === 'assistant' ? <MarkdownRenderer content={message.content} /> : <pre>{message.content}</pre>}
              </div>
            </article>
          ))}

          {pendingApproval ? (
            <article className="agent-approval-card">
              <div className="agent-approval-head">
                <div>
                  <p className="eyebrow">Approval required</p>
                  <h3>{pendingApproval.request.summary}</h3>
                </div>
                <ShieldAlert size={18} />
              </div>

              {pendingPreview?.kind === 'file' ? (
                <p>
                  {pendingPreview.isNewFile ? 'New file' : 'Existing file'}: <code>{pendingPreview.path}</code>
                </p>
              ) : null}

              {pendingPreview?.kind === 'delete' ? (
                <p>
                  Delete <code>{pendingPreview.path}</code>
                  {pendingPreview.isDirectory ? ' (folder)' : ' (file)'}.
                </p>
              ) : null}

              {pendingPreview?.kind === 'command' ? (
                <pre>{`${pendingPreview.cwd}\n$ ${pendingPreview.command}`}</pre>
              ) : null}

              <div className="action-row">
                {pendingPreview?.kind === 'file' ? (
                  <button className="ghost-button compact" type="button" onClick={() => setReviewModalOpen(true)}>
                    <Play size={14} />
                    Review diff
                  </button>
                ) : null}
                <button className="danger-button compact" type="button" disabled={busy} onClick={() => void handleApproval(false)}>
                  <X size={14} />
                  Deny
                </button>
                <button className="primary-button compact" type="button" disabled={busy} onClick={() => void handleApproval(true)}>
                  <Check size={14} />
                  Approve
                </button>
              </div>
            </article>
          ) : null}
        </div>

        <div className="agent-composer">
          <textarea
            value={draftPrompt}
            disabled={!workspacePath || busy}
            onChange={(event) => setDraftPrompt(event.target.value)}
            placeholder={workspacePath ? 'Ask the copilot to inspect, explain, or change your workspace…' : 'Open a workspace to start the agent.'}
            rows={4}
          />
          <div className="agent-composer-actions">
            <span className="agent-composer-hint">
              {pendingApproval ? 'Resolve the pending approval to continue.' : 'Mutating tools pause for approval.'}
            </span>
            <button className="primary-button" type="button" disabled={!canSend} onClick={() => void handleSendPrompt()}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
              Send
            </button>
          </div>
        </div>
      </section>

      <Modal
        open={reviewModalOpen && pendingPreview?.kind === 'file'}
        title={pendingPreview?.kind === 'file' ? `Review ${pendingPreview.path}` : 'Review change'}
        subtitle="Monaco diff preview before the change is applied."
        size="xl"
        onClose={() => setReviewModalOpen(false)}
      >
        {pendingPreview?.kind === 'file' ? (
          <div className="agent-diff-review">
            <div className="agent-diff-meta">
              <span className="release-badge">{pendingPreview.isNewFile ? 'New file' : 'Existing file'}</span>
              {pendingPreview.stats ? (
                <span className="release-badge">{pendingPreview.stats.changedLines} changed lines</span>
              ) : null}
            </div>
            <div className="agent-diff-shell">
              <DiffEditor
                height="100%"
                original={pendingPreview.originalContent}
                modified={pendingPreview.nextContent}
                language="cpp"
                theme="vs-dark"
                options={{
                  readOnly: true,
                  automaticLayout: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: 13,
                }}
              />
            </div>
            <div className="form-actions">
              <button className="danger-button compact" type="button" disabled={busy} onClick={() => void handleApproval(false)}>
                <X size={14} />
                Deny
              </button>
              <button className="primary-button compact" type="button" disabled={busy} onClick={() => void handleApproval(true)}>
                <Check size={14} />
                Approve change
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function safeParseArgs(value: string) {
  return safeJsonParse<Record<string, unknown>>(value || '{}', {});
}

function describeApprovalResolution(resolution: AgentApprovalResolution, toolName: AgentToolName) {
  if (!resolution.success) {
    return `Tool ${toolName} failed: ${resolution.error}`;
  }

  return resolution.output;
}
