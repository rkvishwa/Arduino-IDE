import type { Models } from 'appwrite';

import { ID, Permission, Role, databases } from './appwrite';
import { appwriteConfig, hasBoardAdminFunction } from './config';
import { executeFunction } from './functions';
import type { BoardDocument, BoardInput } from './models';
import { generateToken, sha256Hex } from './utils';

function boardPermissions(userId: string) {
  return [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ];
}

type BoardFunctionPayload = {
  board: BoardDocument;
  apiToken: string;
};

export async function listBoards() {
  const response = await databases.listDocuments<BoardDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.boardsCollectionId,
  );

  return response.documents.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createBoard(input: BoardInput, user: Models.User<Models.Preferences>) {
  if (hasBoardAdminFunction()) {
    return executeFunction<BoardInput, BoardFunctionPayload>(appwriteConfig.boardAdminFunctionId, input);
  }

  const apiToken = generateToken();
  const tokenHash = await sha256Hex(apiToken);
  const now = new Date().toISOString();

  const board = await databases.createDocument<BoardDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.boardsCollectionId,
    ID.unique(),
    {
      userId: user.$id,
      name: input.name,
      boardType: input.boardType,
      apiToken: '',
      wifiSSID: input.wifiSSID,
      wifiPassword: '',
      tokenHash,
      tokenPreview: apiToken.slice(-6),
      firmwareVersion: '1.0.0',
      status: 'pending',
      lastSeen: null,
      lastProvisionedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    boardPermissions(user.$id),
  );

  return { board, apiToken };
}

export async function updateBoard(boardId: string, updates: Partial<BoardDocument>) {
  const safeUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => {
      return (
        value !== undefined &&
        [
          'name',
          'wifiSSID',
          'status',
          'lastSeen',
          'lastProvisionedAt',
          'firmwareVersion',
          'updatedAt',
        ].includes(key)
      );
    }),
  );

  return databases.updateDocument<BoardDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.boardsCollectionId,
    boardId,
    safeUpdates,
  );
}

export async function deleteBoard(boardId: string) {
  await databases.deleteDocument(appwriteConfig.databaseId, appwriteConfig.boardsCollectionId, boardId);
}

export async function rotateBoardToken(boardId: string) {
  if (hasBoardAdminFunction()) {
    return executeFunction<{ boardId: string }, BoardFunctionPayload>(appwriteConfig.boardAdminFunctionId, { boardId }, '/rotate-token');
  }

  const apiToken = generateToken();
  const tokenHash = await sha256Hex(apiToken);
  const board = await databases.updateDocument<BoardDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.boardsCollectionId,
    boardId,
    {
      apiToken: '',
      tokenHash,
      tokenPreview: apiToken.slice(-6),
      updatedAt: new Date().toISOString(),
    },
  );

  return { board, apiToken };
}
