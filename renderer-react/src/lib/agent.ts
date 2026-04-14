import { ID, Permission, Query, Role, databases } from './appwrite';
import { executeFunction } from './functions';
import { appwriteConfig } from './config';
import type { AgentToolName } from '@/types/electron';
import type { AgentSettingsDocument } from './models';
import { safeJsonParse } from './utils';

export type AgentProvider = 'appwrite-default' | 'openrouter' | 'groq';

export type AgentSettings = {
  documentId: string | null;
  apiProvider: AgentProvider;
  apiKey: string;
  model: string;
};

export type AgentUiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  content: string;
  tone?: 'default' | 'success' | 'error' | 'warning';
  toolName?: AgentToolName;
};

export type AgentChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: AgentToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string; name: string };

export type AgentToolCall = {
  id: string;
  type: 'function';
  function: {
    name: AgentToolName;
    arguments: string;
  };
};

type ChatCompletionResponse = {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: AgentToolCall[];
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
};

type AgentCompletionRequest = {
  settings: AgentSettings;
  messages: AgentChatMessage[];
};

function settingsPermissions(userId: string) {
  return [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ];
}

export const AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Return a recursive tree for a workspace-relative path. Use "." to inspect the whole project.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative directory or file path. Use "." for the workspace root.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 file from the workspace.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative file path.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file. The user must approve it before it is applied.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative file path.',
          },
          content: {
            type: 'string',
            description: 'The complete file contents to write.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Apply a SEARCH/REPLACE diff to an existing file. Use blocks formatted as <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative file path.',
          },
          diff: {
            type: 'string',
            description:
              'One or more SEARCH/REPLACE blocks. SEARCH text must match exactly once in the current file.',
          },
        },
        required: ['path', 'diff'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file or folder from the workspace. The user must approve it before it is applied.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative path to delete.',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the workspace root. The user must approve it before it is executed.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to run.',
          },
        },
        required: ['command'],
      },
    },
  },
] as const;

export function createDefaultAgentSettings(): AgentSettings {
  return {
    documentId: null,
    apiProvider: 'appwrite-default',
    apiKey: '',
    model: '',
  };
}

export async function loadAgentSettings(userId: string) {
  const response = await databases.listDocuments<AgentSettingsDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.agentSettingsCollectionId,
    [Query.equal('userId', userId), Query.limit(1)],
  );

  const [document] = response.documents;
  if (!document) {
    return createDefaultAgentSettings();
  }

  return {
    documentId: document.$id,
    apiProvider: normalizeProvider(document.apiProvider),
    apiKey: document.apiKey || '',
    model: document.model || '',
  };
}

export async function saveAgentSettings(userId: string, settings: AgentSettings) {
  const now = new Date().toISOString();
  const payload = {
    userId,
    apiProvider: settings.apiProvider,
    apiKey: settings.apiKey || null,
    model: settings.model || null,
    updatedAt: now,
  };

  if (settings.documentId) {
    const document = await databases.updateDocument<AgentSettingsDocument>(
      appwriteConfig.databaseId,
      appwriteConfig.agentSettingsCollectionId,
      settings.documentId,
      payload,
      settingsPermissions(userId),
    );

    return {
      documentId: document.$id,
      apiProvider: normalizeProvider(document.apiProvider),
      apiKey: document.apiKey || '',
      model: document.model || '',
    };
  }

  const document = await databases.createDocument<AgentSettingsDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.agentSettingsCollectionId,
    ID.unique(),
    {
      ...payload,
      createdAt: now,
    },
    settingsPermissions(userId),
  );

  return {
    documentId: document.$id,
    apiProvider: normalizeProvider(document.apiProvider),
    apiKey: document.apiKey || '',
    model: document.model || '',
  };
}

export async function requestAgentCompletion({ settings, messages }: AgentCompletionRequest) {
  const requestBody = {
    model: settings.model || undefined,
    messages,
    tools: AGENT_TOOL_DEFINITIONS,
    tool_choice: 'auto',
    parallel_tool_calls: false,
    temperature: 0.2,
  };

  if (settings.apiProvider === 'appwrite-default') {
    return executeFunction<{ provider: string; request: Record<string, unknown> }, ChatCompletionResponse>(
      appwriteConfig.proxyAiRequestFunctionId,
      {
        provider: 'openrouter',
        request: requestBody,
      },
    );
  }

  if (!settings.apiKey.trim()) {
    throw new Error('Add your API key before sending prompts with a custom provider.');
  }

  if (!settings.model.trim()) {
    throw new Error('Choose a model before sending prompts with a custom provider.');
  }

  const endpoint =
    settings.apiProvider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey.trim()}`,
      'Content-Type': 'application/json',
      ...(settings.apiProvider === 'openrouter'
        ? {
            'HTTP-Referer': 'https://tantalum-ide.local',
            'X-Title': 'Tantalum IDE',
          }
        : {}),
    },
    body: JSON.stringify({
      ...requestBody,
      model: settings.model.trim(),
    }),
  });

  const rawText = await response.text();
  const parsed = safeJsonParse<ChatCompletionResponse>(rawText, {});

  if (!response.ok) {
    throw new Error(parsed.error?.message || rawText || 'The provider request failed.');
  }

  return parsed;
}

export function createAgentSystemPrompt() {
  return [
    'You are Tantalum Copilot, an expert AI software engineer embedded inside an Electron IDE.',
    'You can inspect the active workspace and use tools to read, edit, create, delete, and execute commands in the project.',
    'Follow this operating procedure whenever you are asked to change code:',
    '1. Inspect the project structure with list_files before making assumptions.',
    '2. Read the relevant files before proposing edits.',
    '3. Explain your reasoning briefly before using mutating tools.',
    '4. Prefer edit_file for focused changes and write_file for full rewrites or new files.',
    '5. For edit_file you must use SEARCH/REPLACE blocks exactly in this format:',
    '<<<<<<< SEARCH',
    'old text',
    '=======',
    'new text',
    '>>>>>>> REPLACE',
    '6. Use workspace-relative paths only.',
    '7. Never claim a change was applied until the corresponding tool result confirms it.',
    '8. Keep responses concise, practical, and focused on the user task.',
  ].join('\n');
}

export function createWorkspaceContextMessage(workspaceRoot: string | null, workspaceMap: string, revision: number) {
  return [
    `Workspace root: ${workspaceRoot || '(none)'}`,
    `Workspace revision: ${revision}`,
    'Workspace tree:',
    workspaceMap,
  ].join('\n');
}

export function createUserPrompt(prompt: string, activeTab: { path: string; name: string; content: string; isDirty: boolean } | null) {
  if (!activeTab) {
    return prompt;
  }

  return [
    prompt,
    '',
    'Active editor context:',
    `File: ${activeTab.path}`,
    `Display name: ${activeTab.name}`,
    `Unsaved changes: ${activeTab.isDirty ? 'yes' : 'no'}`,
    'Current buffer:',
    activeTab.content,
  ].join('\n');
}

export function pruneConversation(messages: AgentChatMessage[], limit = 24) {
  if (messages.length <= limit) {
    return messages;
  }

  return messages.slice(messages.length - limit);
}

export function normalizeProvider(value: string): AgentProvider {
  if (value === 'groq' || value === 'openrouter' || value === 'appwrite-default') {
    return value;
  }

  return 'appwrite-default';
}
