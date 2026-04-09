import type { Models } from 'appwrite';

import { ID, Permission, Query, Role, databases, storage } from './appwrite';
import { appwriteConfig } from './config';
import type { BoardDocument, FirmwareDocument } from './models';

function firmwarePermissions(userId: string) {
  return [
    Permission.read(Role.user(userId)),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ];
}

function firmwareFilePermissions(userId: string) {
  return [
    Permission.read(Role.any()),
    Permission.update(Role.user(userId)),
    Permission.delete(Role.user(userId)),
  ];
}

function base64ToFile(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new File([bytes], filename, { type: 'application/octet-stream' });
}

export async function listFirmwareHistory(boardId: string) {
  const response = await databases.listDocuments<FirmwareDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.firmwareCollectionId,
    [Query.equal('boardId', boardId)],
  );

  return response.documents.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

export async function uploadFirmwareRelease(payload: {
  user: Models.User<Models.Preferences>;
  board: BoardDocument;
  version: string;
  compileResult: {
    filename: string;
    binData: string;
    binSize: number;
  };
  checksum: string;
  notes?: string;
}) {
  const file = await storage.createFile(
    appwriteConfig.firmwareBucketId,
    ID.unique(),
    base64ToFile(payload.compileResult.binData, payload.compileResult.filename),
    firmwareFilePermissions(payload.user.$id),
  );

  const now = new Date().toISOString();
  const existing = await listFirmwareHistory(payload.board.$id);

  await Promise.all(
    existing
      .filter((firmware) => firmware.deployed)
      .map((firmware) =>
        databases.updateDocument<FirmwareDocument>(
          appwriteConfig.databaseId,
          appwriteConfig.firmwareCollectionId,
          firmware.$id,
          { deployed: false },
        ),
      ),
  );

  const firmware = await databases.createDocument<FirmwareDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.firmwareCollectionId,
    ID.unique(),
    {
      userId: payload.user.$id,
      boardId: payload.board.$id,
      version: payload.version,
      fileId: file.$id,
      filename: payload.compileResult.filename,
      size: payload.compileResult.binSize,
      checksum: payload.checksum,
      uploadedAt: now,
      deployed: true,
      notes: payload.notes ?? '',
    },
    firmwarePermissions(payload.user.$id),
  );

  await databases.updateDocument<BoardDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.boardsCollectionId,
    payload.board.$id,
    {
      firmwareVersion: payload.version,
      updatedAt: now,
    },
  );

  return firmware;
}

export async function markFirmwareAsCurrent(board: BoardDocument, firmware: FirmwareDocument) {
  const history = await listFirmwareHistory(board.$id);

  await Promise.all(
    history.map((entry) =>
      databases.updateDocument<FirmwareDocument>(
        appwriteConfig.databaseId,
        appwriteConfig.firmwareCollectionId,
        entry.$id,
        { deployed: entry.$id === firmware.$id },
      ),
    ),
  );

  await databases.updateDocument<BoardDocument>(
    appwriteConfig.databaseId,
    appwriteConfig.boardsCollectionId,
    board.$id,
    {
      firmwareVersion: firmware.version,
      updatedAt: new Date().toISOString(),
    },
  );
}

export async function deleteFirmwareRelease(firmware: FirmwareDocument) {
  await storage.deleteFile(appwriteConfig.firmwareBucketId, firmware.fileId);
  await databases.deleteDocument(appwriteConfig.databaseId, appwriteConfig.firmwareCollectionId, firmware.$id);
}
