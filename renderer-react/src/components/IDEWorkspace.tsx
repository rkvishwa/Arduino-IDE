import '@knurdz/jack-file-tree/keyboard-shield';

import { startTransition, useDeferredValue, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Models } from 'appwrite';
import {
  EditorTabs,
  closeEditorTab,
  markEditorTabDirty,
  markEditorTabSaved,
  openEditorTab,
  reorderEditorTabs,
  type EditorTabItem,
} from '@knurdz/jack-editor-tab';
import { FileTree, type FileTreeFsAdapter, type FileTreeItemType, type FileTreeNode, type FileTreeTheme } from '@knurdz/jack-file-tree';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import {
  BellDot,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Cpu,
  FolderOpen,
  HardDriveDownload,
  HardDriveUpload,
  Library,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCcw,
  Save,
  Search,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import type { editor } from 'monaco-editor';

import { signOut } from '@/lib/auth';
import { createBoard, deleteBoard, listBoards, rotateBoardToken, updateBoard } from '@/lib/boards';
import { appwriteConfig, hasBoardAdminFunction, hasDeviceGatewayFunction, hasRequiredCloudConfiguration } from '@/lib/config';
import { deleteFirmwareRelease, listFirmwareHistory, markFirmwareAsCurrent, uploadFirmwareRelease } from '@/lib/firmware';
import type { BoardDocument, BoardInput, BoardSecret, FirmwareDocument } from '@/lib/models';
import {
  calculateBoardStatus,
  fileNameFromPath,
  formatBytes,
  isFirmwareFileName,
  joinPath,
  nextSemver,
  normalizeOutput,
  parentPath,
  sha256Hex,
} from '@/lib/utils';
import type { MenuAction } from '@/types/electron';

import { ConsoleTerminal } from './ConsoleTerminal';
import { Modal } from './Modal';
import { TerminalWorkspace } from './TerminalWorkspace';

type IDEWorkspaceProps = {
  appName: string;
  version: string;
  user: Models.User<Models.Preferences>;
  onSignedOut: () => void;
};

type SidebarView = 'explorer' | 'boards' | 'libraries' | 'platforms' | 'terminal';
type ConsoleView = 'output' | 'terminal';
type FileTabState = 'temporary' | 'preview' | 'saved';

type FileTab = EditorTabItem & {
  id: string;
  content: string;
  fileState: FileTabState;
};

type ConsoleEntry = {
  id: number;
  level: 'info' | 'success' | 'error';
  message: string;
};

type Toast = {
  id: number;
  tone: 'info' | 'success' | 'error';
  message: string;
};

type BoardPlatform = {
  id: string;
  name: string;
  latest?: string;
  version?: string;
  maintainer?: string;
  description?: string;
  website?: string;
  installed?: boolean;
};

type LibraryEntry = {
  name: string;
  version?: string;
  sentence?: string;
  paragraph?: string;
  author?: string;
  maintainer?: string;
  category?: string;
  installed?: boolean;
};

type ResizablePanel = 'left' | 'right' | 'bottom';

type PanelSizes = Record<ResizablePanel, number>;

type ResizeSession = {
  panel: ResizablePanel;
  pointerId: number;
  startX: number;
  startY: number;
  startSize: number;
};

const DEFAULT_PANEL_SIZES: PanelSizes = {
  left: 280,
  right: 300,
  bottom: 260,
};

const MIN_PANEL_SIZES: PanelSizes = {
  left: 220,
  right: 240,
  bottom: 160,
};

const PANEL_RESIZER_SIZE = 6;
const ACTIVITY_RAIL_WIDTH = 50;
const MIN_EDITOR_WIDTH = 360;
const MAX_SIDE_PANEL_WIDTH = 520;
const MAX_CONSOLE_HEIGHT = 520;
const PANEL_RESIZE_STEP = 16;
const RIGHT_PANEL_HIDDEN_BREAKPOINT = 1320;
const LEFT_PANEL_HIDDEN_BREAKPOINT = 980;

const BOARD_OPTIONS = [
  { value: 'esp32:esp32:esp32', label: 'ESP32 DevKit' },
  { value: 'esp32:esp32:esp32s2', label: 'ESP32-S2' },
  { value: 'esp32:esp32:esp32s3', label: 'ESP32-S3' },
  { value: 'esp32:esp32:esp32c3', label: 'ESP32-C3' },
  { value: 'esp8266:esp8266:generic', label: 'ESP8266 Generic' },
  { value: 'arduino:avr:uno', label: 'Arduino Uno' },
];

const DEFAULT_TAB_CONTENT = `// Start writing firmware in ${new Date().getFullYear()}

void setup() {
  // Put your setup code here.
}

void loop() {
  // Put your main code here.
}
`;

const FILE_TREE_INTERNAL_TRASH_DIR = '.tantalum-file-tree-trash';

const FILE_TREE_THEME: FileTreeTheme = {
  backgroundPrimary: '#0b1117',
  backgroundSecondary: '#101720',
  backgroundHover: 'rgba(108, 166, 255, 0.08)',
  textPrimary: '#f3f7fb',
  textSecondary: '#9baaba',
  textMuted: '#637384',
  accent: '#6ca6ff',
  accentTransparent: 'rgba(108, 166, 255, 0.16)',
  danger: '#ff7b72',
  menuBackground: '#121a23',
  menuBorder: 'rgba(255, 255, 255, 0.08)',
  menuHover: 'rgba(108, 166, 255, 0.12)',
  menuText: '#edf3f9',
  sidebarBorder: 'rgba(255, 255, 255, 0.06)',
  openFolderButtonBackground: '#6ca6ff',
  openFolderButtonBackgroundHover: '#82b5ff',
  openFolderButtonText: '#081018',
  openFolderButtonBorder: 'rgba(108, 166, 255, 0.32)',
  fontFamily: "'Space Grotesk', 'Aptos', 'Segoe UI', sans-serif",
};

let untitledTabCounter = 0;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPanelMaxSize(panel: ResizablePanel, sizes: PanelSizes) {
  if (typeof window === 'undefined') {
    return panel === 'bottom' ? MAX_CONSOLE_HEIGHT : MAX_SIDE_PANEL_WIDTH;
  }

  if (panel === 'bottom') {
    return Math.max(MIN_PANEL_SIZES.bottom, Math.min(MAX_CONSOLE_HEIGHT, Math.floor(window.innerHeight * 0.45)));
  }

  if (panel === 'left' && window.innerWidth <= LEFT_PANEL_HIDDEN_BREAKPOINT) {
    return MAX_SIDE_PANEL_WIDTH;
  }

  if (panel === 'right' && window.innerWidth <= RIGHT_PANEL_HIDDEN_BREAKPOINT) {
    return MAX_SIDE_PANEL_WIDTH;
  }

  const isRightPanelVisible = window.innerWidth > RIGHT_PANEL_HIDDEN_BREAKPOINT;
  const siblingWidth = panel === 'left' ? (isRightPanelVisible ? sizes.right : 0) : sizes.left;
  const visibleResizers = isRightPanelVisible ? 2 : 1;
  const availableWidth = window.innerWidth - ACTIVITY_RAIL_WIDTH - PANEL_RESIZER_SIZE * visibleResizers - siblingWidth - MIN_EDITOR_WIDTH;
  return Math.max(MIN_PANEL_SIZES[panel], Math.min(MAX_SIDE_PANEL_WIDTH, availableWidth));
}

function normalizePanelSizes(sizes: PanelSizes): PanelSizes {
  const left = clamp(sizes.left, MIN_PANEL_SIZES.left, getPanelMaxSize('left', sizes));
  const right = clamp(sizes.right, MIN_PANEL_SIZES.right, getPanelMaxSize('right', { ...sizes, left }));
  const bottom = clamp(sizes.bottom, MIN_PANEL_SIZES.bottom, getPanelMaxSize('bottom', sizes));

  return { left, right, bottom };
}

function createUntitledTab(name = 'sketch.ino', content = DEFAULT_TAB_CONTENT): FileTab {
  untitledTabCounter += 1;
  const path = `untitled:${Date.now()}-${untitledTabCounter}`;

  return {
    id: path,
    path,
    name,
    content,
    isDirty: false,
    type: 'file',
    fileState: 'temporary',
  };
}

function createSavedTab(path: string, content: string, options?: { isPreview?: boolean; title?: string }): FileTab {
  const isPreview = options?.isPreview ?? false;

  return {
    id: path,
    path,
    name: fileNameFromPath(path),
    content,
    isDirty: false,
    isPreviewFile: isPreview,
    type: 'file',
    title: options?.title,
    fileState: isPreview ? 'preview' : 'saved',
  };
}

export function IDEWorkspace({ appName, version, user, onSignedOut }: IDEWorkspaceProps) {
  const [sidebar, setSidebar] = useState<SidebarView>('explorer');
  const [consoleView, setConsoleView] = useState<ConsoleView>('output');
  const [consolePanelOpen, setConsolePanelOpen] = useState(true);
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(() => normalizePanelSizes(DEFAULT_PANEL_SIZES));
  const [activeResizePanel, setActiveResizePanel] = useState<ResizablePanel | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [fileTreeRefreshKey, setFileTreeRefreshKey] = useState(0);
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [editorReady, setEditorReady] = useState(false);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([
    { id: Date.now(), level: 'info', message: 'Ready. Open a folder or start writing firmware.' },
  ]);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [boards, setBoards] = useState<BoardDocument[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [selectedBoardSecrets, setSelectedBoardSecrets] = useState<BoardSecret | null>(null);
  const [firmwareHistory, setFirmwareHistory] = useState<FirmwareDocument[]>([]);
  const [boardModalOpen, setBoardModalOpen] = useState(false);
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [boardForm, setBoardForm] = useState<BoardInput>({
    name: '',
    boardType: 'esp32:esp32:esp32',
    wifiSSID: '',
    wifiPassword: '',
  });
  const [provisionPorts, setProvisionPorts] = useState<Array<{ path: string; manufacturer: string }>>([]);
  const [selectedProvisionPort, setSelectedProvisionPort] = useState('');
  const [releaseVersion, setReleaseVersion] = useState('1.0.1');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryResults, setLibraryResults] = useState<LibraryEntry[]>([]);
  const [installedLibraries, setInstalledLibraries] = useState<LibraryEntry[]>([]);
  const [platformQuery, setPlatformQuery] = useState('');
  const [platformResults, setPlatformResults] = useState<BoardPlatform[]>([]);
  const [installedPlatforms, setInstalledPlatforms] = useState<BoardPlatform[]>([]);

  const deferredLibraryQuery = useDeferredValue(libraryQuery);
  const deferredPlatformQuery = useDeferredValue(platformQuery);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const selectedBoard = boards.find((board) => board.$id === selectedBoardId) ?? null;
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const consoleOutputRef = useRef<HTMLDivElement | null>(null);
  const toastCounterRef = useRef(1);
  const treeTrashMapRef = useRef<Map<string, string>>(new Map());
  const previousSidebarRef = useRef<Exclude<SidebarView, 'terminal'>>('explorer');
  const panelSizesRef = useRef<PanelSizes>(panelSizes);
  const resizeSessionRef = useRef<ResizeSession | null>(null);

  function activateTab(nextTab: FileTab) {
    setActiveTabId(nextTab.id);
    setEditorValue(nextTab.content);
  }

  function selectTabByPath(tabPath: string) {
    const nextTab = tabs.find((tab) => tab.path === tabPath);
    if (!nextTab) {
      return;
    }

    activateTab(nextTab);
  }

  function openConsolePanel(nextView?: ConsoleView) {
    if (nextView) {
      setConsoleView(nextView);
    }

    setConsolePanelOpen(true);
  }

  function toggleConsolePanel() {
    setConsolePanelOpen((current) => !current);
  }

  function applyPanelSizes(updater: (current: PanelSizes) => PanelSizes) {
    setPanelSizes((current) => {
      const next = updater(current);
      panelSizesRef.current = next;

      if (current.left === next.left && current.right === next.right && current.bottom === next.bottom) {
        return current;
      }

      return next;
    });
  }

  function setSinglePanelSize(panel: ResizablePanel, value: number) {
    applyPanelSizes((current) => normalizePanelSizes({ ...current, [panel]: value }));
  }

  function resetPanelSize(panel: ResizablePanel) {
    setSinglePanelSize(panel, DEFAULT_PANEL_SIZES[panel]);
  }

  function adjustPanelSize(panel: ResizablePanel, delta: number) {
    setSinglePanelSize(panel, panelSizesRef.current[panel] + delta);
  }

  function beginResize(panel: ResizablePanel, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    resizeSessionRef.current = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startSize: panelSizesRef.current[panel],
    };
    setActiveResizePanel(panel);
    document.body.classList.add('panel-resizing');
    document.body.classList.remove('panel-resizing-row', 'panel-resizing-column');
    document.body.classList.add(panel === 'bottom' ? 'panel-resizing-row' : 'panel-resizing-column');
  }

  function handleResizerKeyDown(panel: ResizablePanel, event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? PANEL_RESIZE_STEP * 2 : PANEL_RESIZE_STEP;

    if (event.key === 'Enter') {
      event.preventDefault();
      resetPanelSize(panel);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setSinglePanelSize(panel, MIN_PANEL_SIZES[panel]);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setSinglePanelSize(panel, getPanelMaxSize(panel, panelSizesRef.current));
      return;
    }

    if (panel === 'bottom') {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        adjustPanelSize(panel, step);
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        adjustPanelSize(panel, -step);
      }

      return;
    }

    const expandKey = panel === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrinkKey = panel === 'left' ? 'ArrowLeft' : 'ArrowRight';

    if (event.key === expandKey) {
      event.preventDefault();
      adjustPanelSize(panel, step);
      return;
    }

    if (event.key === shrinkKey) {
      event.preventDefault();
      adjustPanelSize(panel, -step);
    }
  }

  function toggleTerminalWorkspace() {
    setSidebar((current) => (current === 'terminal' ? previousSidebarRef.current : 'terminal'));
  }

  function pushConsole(message: string, level: ConsoleEntry['level'] = 'info') {
    if (!message.trim()) {
      return;
    }

    setConsoleEntries((current) => [
      ...current,
      {
        id: Date.now() + Math.random(),
        level,
        message,
      },
    ]);
  }

  function pushToast(message: string, tone: Toast['tone'] = 'info') {
    const id = toastCounterRef.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }

  function normalizeTreePath(targetPath: string) {
    return targetPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  function isPathInsideRoot(targetPath: string, rootPath: string) {
    const normalizedTarget = normalizeTreePath(targetPath);
    const normalizedRoot = normalizeTreePath(rootPath);

    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
  }

  function toHostSeparators(targetPath: string, hostPath: string) {
    return hostPath.includes('\\') ? targetPath.replace(/\//g, '\\') : targetPath.replace(/\\/g, '/');
  }

  function relativePathFromRoot(targetPath: string, rootPath: string) {
    const normalizedTarget = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');

    if (normalizedTarget === normalizedRoot) {
      return '';
    }

    if (!normalizedTarget.startsWith(`${normalizedRoot}/`)) {
      return null;
    }

    return normalizedTarget.slice(normalizedRoot.length + 1);
  }

  function remapPathWithinRoot(targetPath: string, sourceRoot: string, destinationRoot: string) {
    const relativePath = relativePathFromRoot(targetPath, sourceRoot);
    if (relativePath === null) {
      return targetPath;
    }

    if (!relativePath) {
      return destinationRoot;
    }

    return joinPath(destinationRoot, toHostSeparators(relativePath, destinationRoot));
  }

  function mapDirectoryItemsToTreeNodes(items: Array<{ name: string; path: string; isDirectory: boolean; extension: string | null }>): FileTreeNode[] {
    return items
      .filter((item) => item.name !== FILE_TREE_INTERNAL_TRASH_DIR && !item.name.startsWith('.trash_'))
      .map((item) => ({
        name: item.name,
        path: item.path,
        type: item.isDirectory ? 'directory' : 'file',
        extension: item.extension ?? undefined,
      }));
  }

  function refreshFileTree() {
    setFileTreeRefreshKey((current) => current + 1);
  }

  function closeTabsForPath(targetPath: string, type: FileTreeItemType) {
    setTabs((current) => {
      const nextTabs = current.filter((tab) => {
        if (tab.path.startsWith('untitled:')) {
          return true;
        }

        if (type === 'file') {
          return tab.path !== targetPath;
        }

        return !isPathInsideRoot(tab.path, targetPath);
      });

      return nextTabs;
    });

    setActiveTabId((current) => {
      if (!current) {
        return current;
      }

      if (type === 'file') {
        if (current === targetPath) {
          return null;
        }
        return current;
      }

      return isPathInsideRoot(current, targetPath) ? null : current;
    });
  }

  function remapOpenTabs(sourceRoot: string, destinationRoot: string) {
    setTabs((current) =>
      current.map((tab) => {
        if (tab.path.startsWith('untitled:') || !isPathInsideRoot(tab.path, sourceRoot)) {
          return tab;
        }

        const nextPath = remapPathWithinRoot(tab.path, sourceRoot, destinationRoot);
        return {
          ...tab,
          id: nextPath,
          path: nextPath,
          name: fileNameFromPath(nextPath),
        };
      }),
    );

    setActiveTabId((current) => (current && isPathInsideRoot(current, sourceRoot) ? remapPathWithinRoot(current, sourceRoot, destinationRoot) : current));
  }

  async function clearInternalTrash(workspaceRoot: string) {
    const trashPath = joinPath(workspaceRoot, FILE_TREE_INTERNAL_TRASH_DIR);
    const result = await window.tantalum.fs.deletePath(trashPath);

    if (!result.success && !result.error.toLowerCase().includes('does not exist')) {
      pushConsole(`Unable to clean workspace trash: ${result.error}`, 'error');
    }
  }

  async function ensureInternalTrashFolder(workspaceRoot: string) {
    const result = await window.tantalum.fs.createFolder(workspaceRoot, FILE_TREE_INTERNAL_TRASH_DIR);

    if (!result.success && !result.error.toLowerCase().includes('already exists')) {
      throw new Error(result.error);
    }

    return joinPath(workspaceRoot, FILE_TREE_INTERNAL_TRASH_DIR);
  }

  async function copyWorkspaceEntry(sourcePath: string, destinationPath: string): Promise<string> {
    const directoryResult = await window.tantalum.fs.readDirectory(sourcePath);
    if (directoryResult.success) {
      const createFolderResult = await window.tantalum.fs.createFolder(parentPath(destinationPath), fileNameFromPath(destinationPath));
      if (!createFolderResult.success) {
        throw new Error(createFolderResult.error);
      }

      for (const item of directoryResult.items) {
        await copyWorkspaceEntry(item.path, joinPath(destinationPath, item.name));
      }

      return createFolderResult.path;
    }

    const fileResult = await window.tantalum.fs.readFile(sourcePath);
    if (!fileResult.success) {
      throw new Error(fileResult.error);
    }

    const createFileResult = await window.tantalum.fs.createFile(parentPath(destinationPath), fileNameFromPath(destinationPath), fileResult.content);
    if (!createFileResult.success) {
      throw new Error(createFileResult.error);
    }

    return createFileResult.path;
  }

  async function syncBoardSecrets(boardId: string) {
    const result = await window.tantalum.secrets.getBoardSecrets(boardId);
    if (result.success) {
      setSelectedBoardSecrets((result.secrets as BoardSecret | null) ?? null);
    }
  }

  async function refreshBoardsList() {
    if (!hasRequiredCloudConfiguration()) {
      return;
    }

    try {
      const nextBoards = await listBoards();
      setBoards(nextBoards);

      if (!selectedBoardId && nextBoards.length > 0) {
        setSelectedBoardId(nextBoards[0].$id);
      }

      if (selectedBoardId && !nextBoards.some((board) => board.$id === selectedBoardId)) {
        setSelectedBoardId(nextBoards[0]?.$id ?? '');
      }
    } catch (error) {
      pushConsole(error instanceof Error ? error.message : 'Unable to load boards.', 'error');
    }
  }

  async function refreshFirmware(board: BoardDocument | null) {
    if (!board) {
      setFirmwareHistory([]);
      return;
    }

    try {
      const history = await listFirmwareHistory(board.$id);
      setFirmwareHistory(history);
      setReleaseVersion(nextSemver(board.firmwareVersion || history[0]?.version || '1.0.0'));
    } catch (error) {
      pushConsole(error instanceof Error ? error.message : 'Unable to load firmware history.', 'error');
    }
  }

  async function refreshInstalledLibraries() {
    const result = await window.tantalum.toolchain.listInstalledLibraries();
    if (!result.success) {
      pushConsole(result.error, 'error');
      return;
    }

    setInstalledLibraries(
      (result.libraries as LibraryEntry[]).map((library) => ({
        ...library,
        installed: true,
      })),
    );
  }

  async function refreshInstalledPlatforms() {
    const result = await window.tantalum.toolchain.listInstalledPlatforms();
    if (!result.success) {
      pushConsole(result.error, 'error');
      return;
    }

    setInstalledPlatforms((result.platforms as BoardPlatform[]) ?? []);
  }

  async function openWorkspace(folderPath: string) {
    const result = await window.tantalum.fs.setWorkspace(folderPath);
    if (!result.success) {
      pushToast(result.error, 'error');
      return;
    }

    treeTrashMapRef.current.clear();
    await clearInternalTrash(result.path);
    setWorkspacePath(result.path);
    refreshFileTree();
    pushConsole(`Opened workspace: ${result.path}`, 'success');
  }

  async function openFolderPicker() {
    const result = await window.tantalum.fs.openFolder();
    if (result.success) {
      await openWorkspace(result.path);
    }
  }

  const fileTreeFs: FileTreeFsAdapter = {
    readDirectory: async (dirPath) => {
      const result = await window.tantalum.fs.readDirectory(dirPath);
      if (!result.success) {
        throw new Error(result.error);
      }

      return mapDirectoryItemsToTreeNodes(result.items);
    },
    readFile: async (filePath) => {
      const result = await window.tantalum.fs.readFile(filePath);
      if (!result.success) {
        throw new Error(result.error);
      }

      return result.content;
    },
    createFile: async (targetPath) => {
      const result = await window.tantalum.fs.createFile(parentPath(targetPath), fileNameFromPath(targetPath), '');
      if (!result.success) {
        throw new Error(result.error);
      }

      return result.path;
    },
    createFolder: async (targetPath) => {
      const result = await window.tantalum.fs.createFolder(parentPath(targetPath), fileNameFromPath(targetPath));
      if (!result.success) {
        throw new Error(result.error);
      }

      return result.path;
    },
    renameItem: async (oldPath, newPath) => {
      const mappedTrashPath = treeTrashMapRef.current.get(oldPath);
      if (mappedTrashPath) {
        const restoreResult = await window.tantalum.fs.rename(mappedTrashPath, newPath);
        if (!restoreResult.success) {
          throw new Error(restoreResult.error);
        }

        treeTrashMapRef.current.delete(oldPath);
        return restoreResult.path;
      }

      if (workspacePath && fileNameFromPath(newPath).startsWith('.trash_')) {
        const trashRoot = await ensureInternalTrashFolder(workspacePath);
        const hiddenTrashPath = joinPath(trashRoot, fileNameFromPath(newPath));
        const trashResult = await window.tantalum.fs.rename(oldPath, hiddenTrashPath);
        if (!trashResult.success) {
          throw new Error(trashResult.error);
        }

        treeTrashMapRef.current.set(newPath, hiddenTrashPath);
        return newPath;
      }

      const result = await window.tantalum.fs.rename(oldPath, newPath);
      if (!result.success) {
        throw new Error(result.error);
      }

      return result.path;
    },
    copyItem: async (oldPath, newPath) => copyWorkspaceEntry(oldPath, newPath),
  };

  function updateTabContent(tabPath: string, nextContent: string) {
    setTabs((current) => {
      const activeFileTab = current.find((tab) => tab.path === tabPath);
      if (!activeFileTab) {
        return current;
      }

      const nextFileState: FileTabState = activeFileTab.fileState === 'temporary' ? 'temporary' : 'saved';

      return markEditorTabDirty(current, tabPath, {
        content: nextContent,
        fileState: nextFileState,
        type: 'file',
      });
    });
  }

  async function openFile(filePath: string, options?: { preview?: boolean }) {
    const shouldPreview = options?.preview ?? true;
    const existing = tabs.find((tab) => tab.path === filePath);
    if (existing) {
      if (!shouldPreview && existing.isPreviewFile) {
        const pinnedTab: FileTab = {
          ...existing,
          isPreviewFile: false,
          fileState: 'saved',
          type: 'file',
        };

        setTabs((current) => openEditorTab(current, pinnedTab, { isPreview: false }));
        activateTab(pinnedTab);
        return;
      }

      activateTab(existing);
      return;
    }

    const result = await window.tantalum.fs.readFile(filePath);
    if (!result.success) {
      pushToast(result.error, 'error');
      return;
    }

    const nextTab = createSavedTab(filePath, result.content, { isPreview: shouldPreview });

    setTabs((current) => openEditorTab(current, nextTab, { isPreview: shouldPreview }));
    activateTab(nextTab);
    void window.tantalum.fs.addRecentFile(filePath);
  }

  function createNewTab() {
    const nextTab = createUntitledTab();

    setTabs((current) => [...current, nextTab]);
    activateTab(nextTab);
  }

  function closeTab(tabPath: string) {
    const closingIndex = tabs.findIndex((tab) => tab.path === tabPath);
    if (closingIndex === -1) {
      return;
    }

    const closingTab = tabs[closingIndex];
    if (closingTab.isDirty && !window.confirm(`Close ${closingTab.name} without saving your changes?`)) {
      return;
    }

    const result = closeEditorTab(tabs, tabPath, activeTab?.path ?? null);

    if (result.tabs.length === 0) {
      setTabs([]);
      setActiveTabId(null);
      setEditorValue('');
      return;
    }

    setTabs(result.tabs);

    if (result.activeTabPath) {
      const fallbackTab = result.tabs.find((tab) => tab.path === result.activeTabPath);
      if (fallbackTab) {
        activateTab(fallbackTab);
        return;
      }
    }

    setActiveTabId(null);
  }

  function handleTabReorder(fromIndex: number, toIndex: number) {
    setTabs((current) => reorderEditorTabs(current, fromIndex, toIndex));
  }

  async function saveActiveTab(saveAs = false) {
    if (!activeTab) {
      return;
    }

    let destinationPath = activeTab.path;
    if (saveAs || activeTab.path.startsWith('untitled:')) {
      const result = await window.tantalum.fs.showSaveDialog({
        defaultPath: workspacePath ? joinPath(workspacePath, activeTab.name || 'sketch.ino') : activeTab.name,
        filters: [{ name: 'Arduino Sketch', extensions: ['ino', 'cpp', 'c', 'h'] }],
      });

      if (!result.success) {
        return;
      }

      destinationPath = result.path;
    }

    const writeResult = await window.tantalum.fs.writeFile(destinationPath, editorValue);
    if (!writeResult.success) {
      pushToast(writeResult.error, 'error');
      return;
    }

    const nextName = fileNameFromPath(destinationPath);
    setTabs((current) => {
      const destinationTab = current.find((tab) => tab.path === destinationPath && tab.id !== activeTab.id);
      const baseTab: FileTab = {
        ...activeTab,
        id: destinationPath,
        path: destinationPath,
        name: nextName,
        content: editorValue,
        isPreviewFile: false,
        isDirty: false,
        type: 'file',
        fileState: 'saved',
      };

      if (activeTab.path === destinationPath) {
        return markEditorTabSaved(current, destinationPath, {
          content: editorValue,
          name: nextName,
          fileState: 'saved',
          type: 'file',
          isPreviewFile: false,
        });
      }

      const nextTabs = current
        .filter((tab) => tab.id === activeTab.id || tab.path !== destinationPath)
        .map((tab) => (tab.id === activeTab.id ? baseTab : tab));

      if (destinationTab) {
        return nextTabs;
      }

      return nextTabs;
    });
    setActiveTabId(destinationPath);
    setEditorValue(editorValue);
    pushToast(`Saved ${nextName}`, 'success');
    void window.tantalum.fs.addRecentFile(destinationPath);

    if (workspacePath && isPathInsideRoot(destinationPath, workspacePath) && isFirmwareFileName(nextName)) {
      refreshFileTree();
    }
  }

  async function handleCompile() {
    if (!activeTab) {
      return;
    }

    setBusyAction('compile');
    pushConsole(`Compiling ${activeTab.name} for ${selectedBoard?.boardType ?? 'arduino:avr:uno'}...`);

    const result = await window.tantalum.toolchain.compile({
      code: editorValue,
      board: selectedBoard?.boardType ?? 'arduino:avr:uno',
    });

    setBusyAction(null);

    if (!result.success) {
      pushConsole(result.error, 'error');
      pushToast('Compilation failed.', 'error');
      return;
    }

    pushConsole(normalizeOutput(result.output || 'Compilation finished.'), 'success');
    pushToast(`Compiled ${result.filename}`, 'success');
  }

  async function handleUploadRelease() {
    if (!selectedBoard) {
      pushToast('Choose a board before uploading firmware.', 'info');
      return;
    }

    if (!releaseVersion.match(/^\d+\.\d+\.\d+$/)) {
      pushToast('Use semantic versioning like 1.0.1.', 'error');
      return;
    }

    setBusyAction('upload');
    pushConsole(`Building ${selectedBoard.name} firmware release ${releaseVersion}...`);

    const compileResult = await window.tantalum.toolchain.compile({
      code: editorValue,
      board: selectedBoard.boardType,
    });

    if (!compileResult.success) {
      setBusyAction(null);
      pushConsole(compileResult.error, 'error');
      pushToast('Compilation failed before upload.', 'error');
      return;
    }

    try {
      const checksum = await sha256Hex(compileResult.binData);
      await uploadFirmwareRelease({
        user,
        board: selectedBoard,
        version: releaseVersion,
        notes: releaseNotes,
        checksum,
        compileResult: {
          filename: compileResult.filename,
          binData: compileResult.binData,
          binSize: compileResult.binSize,
        },
      });

      await refreshBoardsList();
      await refreshFirmware(selectedBoard);
      setReleaseModalOpen(false);
      setReleaseNotes('');
      setReleaseVersion(nextSemver(releaseVersion));
      pushToast(`Release ${releaseVersion} uploaded for ${selectedBoard.name}`, 'success');
      pushConsole('Firmware uploaded to Appwrite storage and marked as current.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Firmware upload failed.', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleProvisionBoard() {
    if (!selectedBoard || !selectedProvisionPort) {
      pushToast('Select both a board and a USB port.', 'info');
      return;
    }

    const secretResult = await window.tantalum.secrets.getBoardSecrets(selectedBoard.$id);
    if (!secretResult.success || !secretResult.secrets?.apiToken || !secretResult.secrets?.wifiPassword) {
      pushToast('Local board secrets are missing. Re-create or rotate the board token.', 'error');
      return;
    }

    setBusyAction('provision');
    pushConsole(`Provisioning ${selectedBoard.name} on ${selectedProvisionPort}...`);

    const result = await window.tantalum.toolchain.provisionBoard({
      board: selectedBoard,
      port: selectedProvisionPort,
      secrets: secretResult.secrets,
      appwriteConfig: {
        endpoint: appwriteConfig.endpoint,
        projectId: appwriteConfig.projectId,
        deviceGatewayFunctionId: appwriteConfig.deviceGatewayFunctionId,
        firmwareBucketId: appwriteConfig.firmwareBucketId,
      },
    });

    setBusyAction(null);

    if (!result.success) {
      pushConsole(result.error, 'error');
      pushToast('Provisioning failed.', 'error');
      return;
    }

    await updateBoard(selectedBoard.$id, {
      status: 'pending',
      lastProvisionedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await refreshBoardsList();
    setProvisionModalOpen(false);
    pushToast(`${selectedBoard.name} flashed successfully.`, 'success');
    pushConsole(normalizeOutput(result.output || result.message || 'Provisioning complete.'), 'success');
  }

  async function handleCreateBoard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!boardForm.name || !boardForm.boardType || !boardForm.wifiSSID || !boardForm.wifiPassword) {
      pushToast('Complete the board name, type, SSID, and WiFi password.', 'error');
      return;
    }

    setBusyAction('create-board');
    try {
      const created = await createBoard(boardForm, user);
      await window.tantalum.secrets.setBoardSecrets({
        boardId: created.board.$id,
        apiToken: created.apiToken,
        wifiPassword: boardForm.wifiPassword,
      });
      await refreshBoardsList();
      setSelectedBoardId(created.board.$id);
      setBoardModalOpen(false);
      setBoardForm({ name: '', boardType: 'esp32:esp32:esp32', wifiSSID: '', wifiPassword: '' });
      pushToast(`Added ${created.board.name}`, 'success');
      pushConsole(`Board ${created.board.name} created. Token stored locally on this machine.`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to create the board.', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRotateBoardToken() {
    if (!selectedBoard) {
      return;
    }

    setBusyAction('rotate-token');
    try {
      const rotated = await rotateBoardToken(selectedBoard.$id);
      await window.tantalum.secrets.setBoardSecrets({
        boardId: selectedBoard.$id,
        apiToken: rotated.apiToken,
        wifiPassword: selectedBoardSecrets?.wifiPassword ?? '',
      });
      await refreshBoardsList();
      await syncBoardSecrets(selectedBoard.$id);
      pushToast(`Rotated token for ${selectedBoard.name}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to rotate the board token.', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteBoard() {
    if (!selectedBoard) {
      return;
    }

    if (!window.confirm(`Delete ${selectedBoard.name}?`)) {
      return;
    }

    setBusyAction('delete-board');
    try {
      await deleteBoard(selectedBoard.$id);
      await window.tantalum.secrets.deleteBoardSecrets(selectedBoard.$id);
      await refreshBoardsList();
      setFirmwareHistory([]);
      pushToast(`${selectedBoard.name} deleted.`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to delete board.', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePromoteFirmware(firmware: FirmwareDocument) {
    if (!selectedBoard) {
      return;
    }

    try {
      await markFirmwareAsCurrent(selectedBoard, firmware);
      await refreshBoardsList();
      await refreshFirmware(selectedBoard);
      pushToast(`Promoted ${firmware.version} to current`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to promote firmware.', 'error');
    }
  }

  async function handleDeleteFirmware(firmware: FirmwareDocument) {
    if (!window.confirm(`Delete firmware ${firmware.version}?`)) {
      return;
    }

    try {
      await deleteFirmwareRelease(firmware);
      await refreshFirmware(selectedBoard);
      pushToast(`Deleted firmware ${firmware.version}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to delete firmware.', 'error');
    }
  }

  async function handleInstallLibrary(library: LibraryEntry) {
    setBusyAction(`library:${library.name}`);
    const result = await window.tantalum.toolchain.installLibrary({ name: library.name });
    setBusyAction(null);

    if (!result.success) {
      pushToast(result.error, 'error');
      return;
    }

    pushConsole(normalizeOutput(result.output || `Installed ${library.name}`), 'success');
    pushToast(`Installed ${library.name}`, 'success');
    await refreshInstalledLibraries();
  }

  async function handleInstallPlatform(platform: BoardPlatform) {
    setBusyAction(`platform:${platform.id}`);
    const result = await window.tantalum.toolchain.installBoardPackage({ packageName: `${platform.id}@${platform.latest || platform.version || 'latest'}` });
    setBusyAction(null);

    if (!result.success) {
      pushToast(result.error, 'error');
      return;
    }

    pushConsole(normalizeOutput(result.output || `Installed ${platform.id}`), 'success');
    pushToast(`Installed ${platform.name}`, 'success');
    await refreshInstalledPlatforms();
  }

  async function handleRemovePlatform(platform: BoardPlatform) {
    if (!window.confirm(`Remove ${platform.name}?`)) {
      return;
    }

    setBusyAction(`remove-platform:${platform.id}`);
    const result = await window.tantalum.toolchain.removeBoardPackage({ packageName: platform.id });
    setBusyAction(null);

    if (!result.success) {
      pushToast(result.error, 'error');
      return;
    }

    pushConsole(normalizeOutput(result.output || `Removed ${platform.id}`), 'success');
    pushToast(`Removed ${platform.name}`, 'success');
    await refreshInstalledPlatforms();
  }

  async function handleSignOut() {
    try {
      await signOut();
      onSignedOut();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Unable to sign out.', 'error');
    }
  }

  const handleMenuAction = useEffectEvent(async (action: MenuAction) => {
    switch (action.type) {
      case 'new-file':
        createNewTab();
        break;
      case 'open-folder': {
        const result = await window.tantalum.fs.openFolder();
        if (result.success) {
          await openWorkspace(result.path);
        }
        break;
      }
      case 'save-file':
        await saveActiveTab(false);
        break;
      case 'save-file-as':
        await saveActiveTab(true);
        break;
      case 'show-sketch-folder':
        if (activeTab && !activeTab.path.startsWith('untitled:')) {
          await window.tantalum.shell.openPath(parentPath(activeTab.path));
        } else if (workspacePath) {
          await window.tantalum.shell.openPath(workspacePath);
        }
        break;
      case 'toggle-comment':
        editorRef.current?.trigger('keyboard', 'editor.action.commentLine', null);
        break;
      case 'find':
        editorRef.current?.trigger('keyboard', 'actions.find', null);
        break;
      case 'find-next':
        editorRef.current?.trigger('keyboard', 'editor.action.nextMatchFindAction', null);
        break;
      case 'find-previous':
        editorRef.current?.trigger('keyboard', 'editor.action.previousMatchFindAction', null);
        break;
      case 'compile':
        await handleCompile();
        break;
      case 'upload-cloud':
        setReleaseModalOpen(true);
        break;
      case 'open-library-manager':
        setSidebar('libraries');
        break;
      case 'open-board-manager':
        setSidebar('platforms');
        break;
      case 'install-esp32-support': {
        const result = await window.tantalum.toolchain.installEsp32Support();
        if (!result.success) {
          pushToast(result.error, 'error');
        } else {
          pushConsole(normalizeOutput(result.output || result.message || 'ESP32 support installed.'), 'success');
          pushToast('ESP32 support installed.', 'success');
          await refreshInstalledPlatforms();
        }
        break;
      }
      case 'format-document':
        editorRef.current?.trigger('keyboard', 'editor.action.formatDocument', null);
        break;
      case 'toggle-terminal':
        openConsolePanel('terminal');
        break;
      case 'about':
        pushToast(`${appName} ${version}`, 'info');
        break;
      case 'open-recent-file':
        await openWorkspace(parentPath(action.filePath));
        await openFile(action.filePath, { preview: false });
        break;
      case 'load-example':
        {
          const nextTab = createUntitledTab(`${action.name}.ino`, action.content);
          setTabs((current) => [...current, nextTab]);
          activateTab(nextTab);
        }
        break;
    }
  });

  const handleInstallProgress = useEffectEvent((chunk: string) => {
    pushConsole(normalizeOutput(chunk), 'info');
  });

  const handleSelectedBoardChange = useEffectEvent((board: BoardDocument | null) => {
    if (!board) {
      setSelectedBoardSecrets(null);
      setFirmwareHistory([]);
      return;
    }

    void syncBoardSecrets(board.$id);
    void refreshFirmware(board);
  });

  const initializeWorkspace = useEffectEvent(async () => {
    await refreshBoardsList();
    await refreshInstalledLibraries();
    await refreshInstalledPlatforms();

    const workspaceResult = await window.tantalum.fs.getLastWorkspace();
    if (workspaceResult.success) {
      await openWorkspace(workspaceResult.path);
    }
  });

  function handleTreeDeleted(targetPath: string, type: FileTreeItemType, skipBroadcast?: boolean) {
    if (skipBroadcast) {
      return;
    }

    closeTabsForPath(targetPath, type);
    pushToast(`Removed ${fileNameFromPath(targetPath)}`, 'info');
  }

  function handleTreeRenamed(oldPath: string, newPath: string) {
    remapOpenTabs(oldPath, newPath);
    refreshFileTree();
  }

  function handleTreeFileCreated(createdPath: string, _name: string, savedContent?: string, isUndo?: boolean) {
    if (isUndo && typeof savedContent === 'string') {
      setTabs((current) => {
        if (current.some((tab) => tab.path === createdPath)) {
          return current;
        }

        return [
          ...current,
          createSavedTab(createdPath, savedContent),
        ];
      });
    }

    refreshFileTree();
  }

  function handleTreeFolderCreated() {
    refreshFileTree();
  }

  function handleTreeCopied(newPath: string, type: FileTreeItemType) {
    if (type === 'file') {
      void window.tantalum.fs.addRecentFile(newPath);
    }

    refreshFileTree();
  }

  function handleTreeMoved() {
    refreshFileTree();
  }

  function handleTreeError(details: { error: unknown }) {
    const message = details.error instanceof Error ? details.error.message : 'File operation failed.';
    pushToast(message, 'error');
    pushConsole(message, 'error');
  }

  const activeExplorerPath = activeTab && !activeTab.path.startsWith('untitled:') ? activeTab.path : null;
  const currentTerminalFolderPath = activeTab && !activeTab.path.startsWith('untitled:') ? parentPath(activeTab.path) : workspacePath;
  const isTerminalWorkspaceActive = sidebar === 'terminal';
  const isConsoleVisible = consolePanelOpen && !isTerminalWorkspaceActive;
  const leftPanelMax = getPanelMaxSize('left', panelSizes);
  const rightPanelMax = getPanelMaxSize('right', panelSizes);
  const bottomPanelMax = getPanelMaxSize('bottom', panelSizes);
  const workspaceShellStyle = {
    '--left-panel-width': `${panelSizes.left}px`,
    '--right-panel-width': `${panelSizes.right}px`,
  } as CSSProperties;
  const consoleShellStyle = {
    '--console-height': `${panelSizes.bottom}px`,
  } as CSSProperties;

  const handleResizeMove = useEffectEvent((event: PointerEvent) => {
    const activeResize = resizeSessionRef.current;
    if (!activeResize || event.pointerId !== activeResize.pointerId) {
      return;
    }

    event.preventDefault();

    const delta =
      activeResize.panel === 'left'
        ? event.clientX - activeResize.startX
        : activeResize.panel === 'right'
          ? activeResize.startX - event.clientX
          : activeResize.startY - event.clientY;

    setSinglePanelSize(activeResize.panel, activeResize.startSize + delta);
  });

  const stopResizing = useEffectEvent((event?: Event) => {
    const activeResize = resizeSessionRef.current;
    if (!activeResize) {
      return;
    }

    if (event instanceof PointerEvent && event.pointerId !== activeResize.pointerId) {
      return;
    }

    resizeSessionRef.current = null;
    setActiveResizePanel(null);
    document.body.classList.remove('panel-resizing', 'panel-resizing-row', 'panel-resizing-column');
  });

  const clampPanelsToViewport = useEffectEvent(() => {
    applyPanelSizes((current) => normalizePanelSizes(current));
  });

  useEffect(() => {
    if (sidebar !== 'terminal') {
      previousSidebarRef.current = sidebar;
    }
  }, [sidebar]);

  useEffect(() => {
    panelSizesRef.current = panelSizes;
  }, [panelSizes]);

  useEffect(() => {
    setActiveTabId((current) => {
      if (tabs.length === 0) {
        return null;
      }

      if (!current || !tabs.some((tab) => tab.id === current)) {
        return tabs[0].id;
      }

      return current;
    });
  }, [tabs]);

  useEffect(() => {
    if (!activeTab) {
      setEditorValue('');
      return;
    }

    setEditorValue(activeTab.content);
  }, [activeTab]);

  useEffect(() => {
    handleSelectedBoardChange(selectedBoard);
  }, [selectedBoardId, selectedBoard]);

  useEffect(() => {
    if (!autoScrollLogs || !consoleOutputRef.current) {
      return;
    }

    consoleOutputRef.current.scrollTop = consoleOutputRef.current.scrollHeight;
  }, [consoleEntries, autoScrollLogs]);

  useEffect(() => {
    void initializeWorkspace();

    const offMenu = window.tantalum.app.onMenuAction((action) => {
      void handleMenuAction(action);
    });
    const offProgress = window.tantalum.toolchain.onInstallProgress((chunk) => {
      handleInstallProgress(chunk);
    });

    return () => {
      offMenu();
      offProgress();
    };
  }, []);

  useEffect(() => {
    clampPanelsToViewport();

    window.addEventListener('resize', clampPanelsToViewport);
    return () => {
      window.removeEventListener('resize', clampPanelsToViewport);
    };
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
    window.addEventListener('blur', stopResizing);

    return () => {
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      window.removeEventListener('blur', stopResizing);
      document.body.classList.remove('panel-resizing', 'panel-resizing-row', 'panel-resizing-column');
    };
  }, []);

  useEffect(() => {
    if (sidebar !== 'libraries') {
      return;
    }

    let isCancelled = false;

    async function runSearch() {
      const result = deferredLibraryQuery.trim()
        ? await window.tantalum.toolchain.searchLibraries(deferredLibraryQuery.trim())
        : await window.tantalum.toolchain.getFeaturedLibraries();

      if (!result.success || isCancelled) {
        if (!result.success) {
          pushConsole(result.error, 'error');
        }
        return;
      }

      const installedNames = new Set(installedLibraries.map((entry) => entry.name));
      const nextLibraries = (result.libraries as LibraryEntry[]).map((entry) => ({
        ...entry,
        installed: installedNames.has(entry.name),
      }));

      startTransition(() => {
        setLibraryResults(nextLibraries);
      });
    }

    void runSearch();

    return () => {
      isCancelled = true;
    };
  }, [sidebar, deferredLibraryQuery, installedLibraries]);

  useEffect(() => {
    if (sidebar !== 'platforms') {
      return;
    }

    let isCancelled = false;

    async function runSearch() {
      const result = await window.tantalum.toolchain.searchBoardPlatforms(deferredPlatformQuery.trim());
      if (!result.success || isCancelled) {
        if (!result.success) {
          pushConsole(result.error, 'error');
        }
        return;
      }

      const installedIds = new Set(installedPlatforms.map((entry) => entry.id));
      const nextPlatforms = (result.platforms as BoardPlatform[]).map((entry) => ({
        ...entry,
        installed: installedIds.has(entry.id),
      }));

      startTransition(() => {
        setPlatformResults(nextPlatforms);
      });
    }

    void runSearch();

    return () => {
      isCancelled = true;
    };
  }, [sidebar, deferredPlatformQuery, installedPlatforms]);

  const editorMount: OnMount = (editorInstance, monaco: Monaco) => {
    editorRef.current = editorInstance;
    monaco.editor.defineTheme('tantalum-minimal', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '66788a' },
        { token: 'keyword', foreground: '8cc7ff' },
        { token: 'string', foreground: 'd8b56a' },
      ],
      colors: {
        'editor.background': '#0b1117',
        'editor.foreground': '#e7edf4',
        'editorLineNumber.foreground': '#5a6b7d',
        'editorLineNumber.activeForeground': '#e7edf4',
        'editorIndentGuide.background1': '#131c26',
        'editor.selectionBackground': '#1a2533',
        'editor.lineHighlightBackground': '#101821',
        'editorCursor.foreground': '#6ca6ff',
        'editorWhitespace.foreground': '#18212c',
      },
    });
    monaco.editor.setTheme('tantalum-minimal');
    editorInstance.focus();
    setEditorReady(true);
  };

  function renderBoardDetails() {
    if (!selectedBoard) {
      return (
        <div className="empty-panel">
          <Cpu size={22} />
          <p>Select a board to view its firmware history, token state, and provisioning options.</p>
        </div>
      );
    }

    const liveStatus = calculateBoardStatus(selectedBoard.lastSeen, selectedBoard.status);

    return (
      <div className="detail-stack">
        <section className="detail-card">
          <div className="detail-head">
            <div>
              <h3>{selectedBoard.name}</h3>
              <p>{selectedBoard.boardType}</p>
            </div>
            <span className={`status-pill status-${liveStatus}`}>{liveStatus}</span>
          </div>
          <dl className="detail-grid">
            <div>
              <dt>WiFi network</dt>
              <dd>{selectedBoard.wifiSSID}</dd>
            </div>
            <div>
              <dt>Current version</dt>
              <dd>{selectedBoard.firmwareVersion || '1.0.0'}</dd>
            </div>
            <div>
              <dt>Token preview</dt>
              <dd>••••••{selectedBoard.tokenPreview || 'n/a'}</dd>
            </div>
            <div>
              <dt>Local secrets</dt>
              <dd>{selectedBoardSecrets?.apiToken && selectedBoardSecrets?.wifiPassword ? 'Available on this machine' : 'Missing locally'}</dd>
            </div>
          </dl>
          <div className="action-row">
            <button className="secondary-button" type="button" onClick={() => setProvisionModalOpen(true)} disabled={!hasDeviceGatewayFunction()}>
              Provision board
            </button>
            <button className="secondary-button" type="button" onClick={() => void handleRotateBoardToken()} disabled={busyAction === 'rotate-token'}>
              Rotate token
            </button>
            <button className="danger-button" type="button" onClick={() => void handleDeleteBoard()} disabled={busyAction === 'delete-board'}>
              Delete board
            </button>
          </div>
          {!hasDeviceGatewayFunction() ? (
            <div className="inline-banner inline-banner-warning">
              Add `VITE_APPWRITE_DEVICE_GATEWAY_FUNCTION_ID` before provisioning or OTA updates will work.
            </div>
          ) : null}
        </section>

        <section className="detail-card">
          <div className="detail-head">
            <div>
              <h3>Firmware history</h3>
              <p>{firmwareHistory.length} release{firmwareHistory.length === 1 ? '' : 's'}</p>
            </div>
            <button className="primary-button compact" type="button" onClick={() => setReleaseModalOpen(true)}>
              New release
            </button>
          </div>
          <div className="release-list">
            {firmwareHistory.length === 0 ? (
              <div className="empty-panel compact">
                <HardDriveUpload size={20} />
                <p>No firmware uploaded yet.</p>
              </div>
            ) : (
              firmwareHistory.map((firmware) => (
                <article key={firmware.$id} className="release-item">
                  <div>
                    <div className="release-title">
                      <strong>{firmware.version}</strong>
                      {firmware.deployed ? <span className="release-badge">Current</span> : null}
                    </div>
                    <p>{firmware.filename}</p>
                    <small>{formatBytes(firmware.size)} • {new Date(firmware.uploadedAt).toLocaleString()}</small>
                  </div>
                  <div className="release-actions">
                    {!firmware.deployed ? (
                      <button className="secondary-button compact" type="button" onClick={() => void handlePromoteFirmware(firmware)}>
                        Promote
                      </button>
                    ) : null}
                    <button className="danger-button compact" type="button" onClick={() => void handleDeleteFirmware(firmware)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={`ide-shell ${consolePanelOpen ? '' : 'ide-shell-console-collapsed'}`}>
      <header className="topbar">
        <div className="brand-cluster">
          <div className="brand-mark">
            <span className="brand-dot" />
            <span className="brand-text">{appName}</span>
          </div>
          <span className="version-pill">v{version}</span>
        </div>

        <div className="toolbar">
          <button className="icon-button" type="button" onClick={createNewTab} title="New sketch">
            <Plus size={16} />
          </button>
          <button className="icon-button" type="button" onClick={() => void openFolderPicker()} title="Open folder">
            <FolderOpen size={16} />
          </button>
          <button className="icon-button" type="button" onClick={() => void saveActiveTab(false)} title="Save file" disabled={!activeTab}>
            <Save size={16} />
          </button>
          <button className="icon-button" type="button" onClick={() => void handleCompile()} title="Compile" disabled={!activeTab}>
            <HardDriveDownload size={16} />
          </button>
          <button className="primary-button compact" type="button" onClick={() => setReleaseModalOpen(true)} disabled={!activeTab || !selectedBoard}>
            <HardDriveUpload size={16} />
            Upload OTA
          </button>
          <button
            className={`icon-button ${isTerminalWorkspaceActive ? 'active' : ''}`}
            type="button"
            onClick={toggleTerminalWorkspace}
            title={isTerminalWorkspaceActive ? 'Return to the previous workspace view' : 'Open immersive terminal workspace'}
          >
            <TerminalSquare size={16} />
          </button>
          <div className="board-selector">
            <Cpu size={15} />
            <select value={selectedBoardId} onChange={(event) => setSelectedBoardId(event.target.value)}>
              <option value="">No cloud board selected</option>
              {boards.map((board) => (
                <option key={board.$id} value={board.$id}>
                  {board.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown size={14} />
          </div>
        </div>

        <div className="user-cluster">
          <button className="secondary-button compact" type="button" onClick={() => setBoardModalOpen(true)}>
            <Plus size={16} />
            Add board
          </button>
          <div className="user-pill">
            <BellDot size={16} />
            <span>{user.name || user.email}</span>
          </div>
          <button className="icon-button" type="button" onClick={() => void handleSignOut()} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {!hasRequiredCloudConfiguration() ? (
        <div className="inline-banner inline-banner-error">
          Appwrite configuration is incomplete. Add the renderer env file before using authentication, boards, database documents, or storage uploads.
        </div>
      ) : null}
      {!hasBoardAdminFunction() ? (
        <div className="inline-banner inline-banner-warning">
          `VITE_APPWRITE_BOARD_ADMIN_FUNCTION_ID` is missing. Board registration still works with a client fallback, but token handling is less robust.
        </div>
      ) : null}

      <main className={`workspace-shell ${isTerminalWorkspaceActive ? 'workspace-shell-terminal' : ''}`} style={workspaceShellStyle}>
        <aside className="activity-rail">
          <button className={sidebar === 'explorer' ? 'active' : ''} type="button" onClick={() => setSidebar('explorer')} title="Explorer">
            <FolderOpen size={18} />
          </button>
          <button className={sidebar === 'boards' ? 'active' : ''} type="button" onClick={() => setSidebar('boards')} title="Boards">
            <Cpu size={18} />
          </button>
          <button className={sidebar === 'libraries' ? 'active' : ''} type="button" onClick={() => setSidebar('libraries')} title="Libraries">
            <Library size={18} />
          </button>
          <button className={sidebar === 'platforms' ? 'active' : ''} type="button" onClick={() => setSidebar('platforms')} title="Board manager">
            <BookOpen size={18} />
          </button>
          <button className={sidebar === 'terminal' ? 'active' : ''} type="button" onClick={() => setSidebar('terminal')} title="Terminal workspace">
            <TerminalSquare size={18} />
          </button>
        </aside>

        <aside className={sidebar === 'explorer' ? 'left-panel left-panel-tree' : 'left-panel'}>
          {sidebar === 'explorer' ? (
            <FileTree
              fs={fileTreeFs}
              workspaceRoot={workspacePath}
              className="workspace-tree-panel"
              activeFilePath={activeExplorerPath}
              onOpenFolder={() => void openFolderPicker()}
              onFileClick={(path) => void openFile(path, { preview: true })}
              onFileOpened={(path, _name, isPreview) => void openFile(path, { preview: isPreview ?? true })}
              onFileDeleted={handleTreeDeleted}
              onFileRenamed={handleTreeRenamed}
              onFileCreated={handleTreeFileCreated}
              onFolderCreated={handleTreeFolderCreated}
              onFileCopied={handleTreeCopied}
              onFileMoved={handleTreeMoved}
              onError={handleTreeError}
              refreshTrigger={fileTreeRefreshKey}
              headerTitle={workspacePath ? fileNameFromPath(workspacePath) : 'Explorer'}
              footer={workspacePath ? <div className="workspace-tree-footer">{workspacePath}</div> : null}
              renderHeader={({ className, title, titleClassName, actionsClassName, defaultActions }) => (
                <div className={className}>
                  <span className={titleClassName}>{title}</span>
                  <div className={actionsClassName}>
                    <button className="sft-tree-action-btn" type="button" title="Open folder" onClick={() => void openFolderPicker()}>
                      <FolderOpen size={16} />
                    </button>
                    <button className="sft-tree-action-btn" type="button" title="Refresh explorer" onClick={refreshFileTree}>
                      <RefreshCcw size={16} />
                    </button>
                    {defaultActions}
                  </div>
                </div>
              )}
              showOpenFolderButton
              openFolderButtonPosition="top"
              sidebarPosition="left"
              theme={FILE_TREE_THEME}
            />
          ) : null}

          {sidebar === 'boards' ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Cloud boards</p>
                  <h2>Devices</h2>
                </div>
                <button className="icon-button" type="button" onClick={() => void refreshBoardsList()} title="Refresh boards">
                  <RefreshCcw size={16} />
                </button>
              </div>
              <div className="panel-content board-list">
                {boards.length === 0 ? (
                  <div className="empty-panel">
                    <Cpu size={24} />
                    <p>No boards yet. Add your first device to start provisioning and OTA uploads.</p>
                    <button className="primary-button compact" type="button" onClick={() => setBoardModalOpen(true)}>
                      Add board
                    </button>
                  </div>
                ) : (
                  boards.map((board) => {
                    const status = calculateBoardStatus(board.lastSeen, board.status);
                    return (
                      <button
                        key={board.$id}
                        className={`board-card ${selectedBoardId === board.$id ? 'active' : ''}`}
                        type="button"
                        onClick={() => setSelectedBoardId(board.$id)}
                      >
                        <div className="board-card-head">
                          <strong>{board.name}</strong>
                          <span className={`status-pill status-${status}`}>{status}</span>
                        </div>
                        <p>{board.boardType}</p>
                        <small>Firmware {board.firmwareVersion || '1.0.0'}</small>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : null}

          {sidebar === 'libraries' ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Tooling</p>
                  <h2>Library Manager</h2>
                </div>
              </div>
              <div className="search-strip">
                <Search size={16} />
                <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search Arduino libraries" />
              </div>
              <div className="panel-content result-list">
                {libraryResults.map((library) => (
                  <article key={library.name} className="result-card manager-result-card">
                    <div className="manager-result-copy">
                      <div className="manager-result-title-row">
                        <strong>{library.name}</strong>
                        {library.installed ? <span className="release-badge">Installed</span> : null}
                      </div>
                      <p>{library.sentence || library.paragraph || library.author || 'Arduino library package'}</p>
                      <div className="manager-result-meta">
                        <span>{library.version || 'latest'}</span>
                        {library.category ? <span>{library.category}</span> : null}
                        {library.author ? <span>{library.author}</span> : null}
                      </div>
                    </div>
                    <button
                      className={`compact manager-result-action ${library.installed ? 'secondary-button' : 'primary-button'}`}
                      type="button"
                      disabled={Boolean(library.installed) || busyAction === `library:${library.name}`}
                      onClick={() => void handleInstallLibrary(library)}
                    >
                      {busyAction === `library:${library.name}` ? <LoaderCircle size={14} className="spin" /> : null}
                      {library.installed ? 'Installed' : 'Install'}
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : null}

          {sidebar === 'platforms' ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Tooling</p>
                  <h2>Board Manager</h2>
                </div>
              </div>
              <div className="search-strip">
                <Search size={16} />
                <input value={platformQuery} onChange={(event) => setPlatformQuery(event.target.value)} placeholder="Search board cores" />
              </div>
              <div className="panel-content result-list">
                {platformResults.map((platform) => (
                  <article key={platform.id} className="result-card manager-result-card">
                    <div className="manager-result-copy">
                      <div className="manager-result-title-row">
                        <strong>{platform.name}</strong>
                        {platform.installed ? <span className="release-badge">Installed</span> : null}
                      </div>
                      <p>{platform.description || platform.maintainer || 'Board platform package'}</p>
                      <div className="manager-result-meta">
                        <span>{platform.latest || platform.version || 'latest'}</span>
                        {platform.maintainer ? <span>{platform.maintainer}</span> : null}
                        {platform.website ? <span>{platform.website.replace(/^https?:\/\//, '')}</span> : null}
                      </div>
                    </div>
                    {platform.installed ? (
                      <button
                        className="danger-button compact manager-result-action"
                        type="button"
                        onClick={() => void handleRemovePlatform(platform)}
                        disabled={busyAction === `remove-platform:${platform.id}`}
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        className="primary-button compact manager-result-action"
                        type="button"
                        onClick={() => void handleInstallPlatform(platform)}
                        disabled={busyAction === `platform:${platform.id}`}
                      >
                        {busyAction === `platform:${platform.id}` ? <LoaderCircle size={14} className="spin" /> : null}
                        Install
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </aside>

        <div
          className={`panel-resizer panel-resizer-vertical panel-resizer-left ${activeResizePanel === 'left' ? 'panel-resizer-active' : ''}`}
          role="separator"
          tabIndex={0}
          aria-label="Resize left panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_PANEL_SIZES.left}
          aria-valuemax={leftPanelMax}
          aria-valuenow={panelSizes.left}
          onDoubleClick={() => resetPanelSize('left')}
          onKeyDown={(event) => handleResizerKeyDown('left', event)}
          onPointerDown={(event) => beginResize('left', event)}
        />

        <div className="terminal-workspace-host">
          <TerminalWorkspace active={isTerminalWorkspaceActive} currentFolderPath={currentTerminalFolderPath} />
        </div>

        <section className="editor-shell">
          <EditorTabs
            tabs={tabs}
            activeTabPath={activeTab?.path ?? null}
            onTabClick={(path) => selectTabByPath(path)}
            onTabClose={(path) => closeTab(path)}
            onTabReorder={handleTabReorder}
          />
          <div className="editor-stage">
            {activeTab ? (
              <Editor
                height="100%"
                defaultLanguage="cpp"
                language="cpp"
                value={editorValue}
                beforeMount={(monaco) => monaco.editor.setTheme('vs-dark')}
                onMount={editorMount}
                onChange={(nextValue) => {
                  const updated = nextValue ?? '';
                  setEditorValue(updated);
                  updateTabContent(activeTab.path, updated);
                }}
                options={{
                  minimap: { enabled: false },
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: 13,
                  automaticLayout: true,
                  smoothScrolling: true,
                  scrollBeyondLastLine: false,
                  overviewRulerLanes: 0,
                  renderLineHighlight: 'line',
                  guides: { indentation: false },
                  lineDecorationsWidth: 12,
                  lineNumbersMinChars: 3,
                  padding: { top: 18, bottom: 18 },
                }}
                theme={editorReady ? 'tantalum-minimal' : 'vs-dark'}
              />
            ) : (
              <div className="editor-empty-state">
                <div className="empty-panel editor-empty-panel">
                  <Plus size={22} />
                  <div className="editor-empty-copy">
                    <strong>No sketch is open</strong>
                    <p>Create a new sketch, open a folder, or pick a file from the explorer when you're ready.</p>
                  </div>
                  <div className="editor-empty-actions">
                    <button className="primary-button compact" type="button" onClick={createNewTab}>
                      <Plus size={16} />
                      New sketch
                    </button>
                    <button className="secondary-button compact" type="button" onClick={() => void openFolderPicker()}>
                      <FolderOpen size={16} />
                      Open folder
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <div
          className={`panel-resizer panel-resizer-vertical panel-resizer-right ${activeResizePanel === 'right' ? 'panel-resizer-active' : ''}`}
          role="separator"
          tabIndex={0}
          aria-label="Resize right panel"
          aria-orientation="vertical"
          aria-valuemin={MIN_PANEL_SIZES.right}
          aria-valuemax={rightPanelMax}
          aria-valuenow={panelSizes.right}
          onDoubleClick={() => resetPanelSize('right')}
          onKeyDown={(event) => handleResizerKeyDown('right', event)}
          onPointerDown={(event) => beginResize('right', event)}
        />

        <aside className="right-panel">{renderBoardDetails()}</aside>
      </main>

      {isConsoleVisible ? (
        <div
          className={`panel-resizer panel-resizer-horizontal panel-resizer-bottom ${activeResizePanel === 'bottom' ? 'panel-resizer-active' : ''}`}
          role="separator"
          tabIndex={0}
          aria-label="Resize bottom panel"
          aria-orientation="horizontal"
          aria-valuemin={MIN_PANEL_SIZES.bottom}
          aria-valuemax={bottomPanelMax}
          aria-valuenow={panelSizes.bottom}
          onDoubleClick={() => resetPanelSize('bottom')}
          onKeyDown={(event) => handleResizerKeyDown('bottom', event)}
          onPointerDown={(event) => beginResize('bottom', event)}
        />
      ) : null}

      <section className={`console-shell ${isConsoleVisible ? '' : 'console-shell-collapsed'}`} style={consoleShellStyle}>
        <div className="console-header">
          <div className="console-tabs">
            <button className={consoleView === 'output' ? 'active' : ''} type="button" onClick={() => openConsolePanel('output')}>
              Output
            </button>
            <button className={consoleView === 'terminal' ? 'active' : ''} type="button" onClick={() => openConsolePanel('terminal')}>
              Terminal
            </button>
          </div>
          <div className="console-actions">
            <button
              className={`ghost-button compact ${autoScrollLogs ? 'active' : ''}`}
              type="button"
              onClick={() => setAutoScrollLogs((current) => !current)}
              title="Toggle output auto scroll"
            >
              Auto-scroll
            </button>
            <button className="icon-button" type="button" onClick={() => setConsoleEntries([])} title="Clear console">
              <Trash2 size={16} />
            </button>
            <button className="icon-button console-collapse-button" type="button" onClick={toggleConsolePanel} title="Minimize bottom panel">
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
        {!isConsoleVisible ? null : (
          <div ref={consoleOutputRef} className={`console-output console-pane ${consoleView === 'output' ? 'console-pane-active' : 'console-pane-hidden'}`}>
            {consoleEntries.map((entry) => (
              <div key={entry.id} className={`console-line console-${entry.level}`}>
                {entry.message}
              </div>
            ))}
          </div>
        )}
        <ConsoleTerminal active={isConsoleVisible && consoleView === 'terminal'} currentFolderPath={currentTerminalFolderPath} />
      </section>

      <footer className="statusbar">
        <span>{workspacePath ? workspacePath : 'No workspace open'}</span>
        <div className="statusbar-actions">
          {!isConsoleVisible && !isTerminalWorkspaceActive ? (
            <button className="ghost-button compact statusbar-console-toggle" type="button" onClick={() => openConsolePanel(consoleView)} title={`Restore ${consoleView} panel`}>
              <ChevronUp size={14} />
              Open {consoleView}
            </button>
          ) : null}
          <span>{selectedBoard ? `${selectedBoard.name} • ${selectedBoard.firmwareVersion || '1.0.0'}` : 'No board selected'}</span>
        </div>
      </footer>

      <Modal open={boardModalOpen} title="Add board" subtitle="WiFi secrets stay local to this computer." onClose={() => setBoardModalOpen(false)}>
        <form className="modal-form" onSubmit={handleCreateBoard}>
          <label>
            Board name
            <input value={boardForm.name} onChange={(event) => setBoardForm((current) => ({ ...current, name: event.target.value }))} placeholder="Living room ESP32" />
          </label>
          <label>
            Board type
            <select value={boardForm.boardType} onChange={(event) => setBoardForm((current) => ({ ...current, boardType: event.target.value }))}>
              {BOARD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            WiFi SSID
            <input value={boardForm.wifiSSID} onChange={(event) => setBoardForm((current) => ({ ...current, wifiSSID: event.target.value }))} placeholder="Office WiFi" />
          </label>
          <label>
            WiFi password
            <input type="password" value={boardForm.wifiPassword} onChange={(event) => setBoardForm((current) => ({ ...current, wifiPassword: event.target.value }))} placeholder="••••••••" />
          </label>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => setBoardModalOpen(false)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={busyAction === 'create-board'}>
              {busyAction === 'create-board' ? 'Creating...' : 'Create board'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={provisionModalOpen}
        title="Provision board"
        subtitle="Flash the OTA bootstrap firmware over USB."
        onClose={() => setProvisionModalOpen(false)}
      >
        <div className="modal-form">
          <label>
            Board
            <select value={selectedBoardId} onChange={(event) => setSelectedBoardId(event.target.value)}>
              <option value="">Select board</option>
              {boards.map((board) => (
                <option key={board.$id} value={board.$id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            USB port
            <div className="compound-row">
              <select value={selectedProvisionPort} onChange={(event) => setSelectedProvisionPort(event.target.value)}>
                <option value="">Select port</option>
                {provisionPorts.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path} • {port.manufacturer}
                  </option>
                ))}
              </select>
              <button
                className="icon-button"
                type="button"
                onClick={() =>
                  void window.tantalum.toolchain.listPorts().then((result) => {
                    if (result.success) {
                      setProvisionPorts(result.ports);
                    } else {
                      pushToast(result.error, 'error');
                    }
                  })
                }
              >
                <RefreshCcw size={16} />
              </button>
            </div>
          </label>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => setProvisionModalOpen(false)}>
              Cancel
            </button>
            <button className="primary-button" type="button" onClick={() => void handleProvisionBoard()} disabled={busyAction === 'provision'}>
              {busyAction === 'provision' ? 'Flashing...' : 'Flash firmware'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={releaseModalOpen} title="Create firmware release" subtitle="Compile the current sketch and upload it to Appwrite storage." onClose={() => setReleaseModalOpen(false)}>
        <div className="modal-form">
          <label>
            Target board
            <select value={selectedBoardId} onChange={(event) => setSelectedBoardId(event.target.value)}>
              <option value="">Select board</option>
              {boards.map((board) => (
                <option key={board.$id} value={board.$id}>
                  {board.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Version
            <input value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)} placeholder="1.0.1" />
          </label>
          <label>
            Release notes
            <textarea value={releaseNotes} onChange={(event) => setReleaseNotes(event.target.value)} placeholder="Optional notes for this firmware release." rows={4} />
          </label>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => setReleaseModalOpen(false)}>
              Cancel
            </button>
            <button className="primary-button" type="button" onClick={() => void handleUploadRelease()} disabled={busyAction === 'upload'}>
              {busyAction === 'upload' ? 'Uploading...' : 'Upload release'}
            </button>
          </div>
        </div>
      </Modal>

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
