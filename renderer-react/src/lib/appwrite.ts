import { ID, Permission, Query, Role } from 'appwrite';
import type { Models } from 'appwrite';

function unwrapResult<T extends object>(result: ({ success: true } & T) | { success: false; error: string }) {
  if (!result.success) {
    throw new Error(result.error);
  }

  return result;
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

export const account = {
  async get() {
    const result = unwrapResult(await window.tantalum.cloud.auth.getCurrentUser());
    return result.user as Models.User<Models.Preferences> | null;
  },
  async create(userId: string, email: string, password: string, name?: string) {
    const result = unwrapResult(await window.tantalum.cloud.auth.register({
      userId,
      email,
      password,
      name: name ?? '',
    }));

    return result.user as Models.User<Models.Preferences>;
  },
  async createEmailSession(email: string, password: string) {
    const result = unwrapResult(await window.tantalum.cloud.auth.signIn({ email, password }));
    return result.session;
  },
  async createEmailPasswordSession(email: string, password: string) {
    const result = unwrapResult(await window.tantalum.cloud.auth.signIn({ email, password }));
    return result.session;
  },
  async deleteSession(sessionId?: string) {
    void sessionId;
    unwrapResult(await window.tantalum.cloud.auth.signOut());
  },
};

export const databases = {
  async listDocuments<T>(databaseId: string, collectionId: string, queries?: string[]) {
    const result = unwrapResult(await window.tantalum.cloud.databases.listDocuments({
      databaseId,
      collectionId,
      queries,
    }));

    return {
      total: result.total,
      documents: result.documents as T[],
    };
  },
  async createDocument<T>(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: Record<string, unknown>,
    permissions?: string[],
  ) {
    const result = unwrapResult(await window.tantalum.cloud.databases.createDocument({
      databaseId,
      collectionId,
      documentId,
      data,
      permissions,
    }));

    return result.document as T;
  },
  async updateDocument<T>(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: Record<string, unknown>,
    permissions?: string[],
  ) {
    const result = unwrapResult(await window.tantalum.cloud.databases.updateDocument({
      databaseId,
      collectionId,
      documentId,
      data,
      permissions,
    }));

    return result.document as T;
  },
  async deleteDocument(databaseId: string, collectionId: string, documentId: string) {
    unwrapResult(await window.tantalum.cloud.databases.deleteDocument({
      databaseId,
      collectionId,
      documentId,
    }));
  },
};

export const storage = {
  async createFile(bucketId: string, fileId: string, file: File, permissions?: string[]) {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);

    const result = unwrapResult(await window.tantalum.cloud.storage.createFile({
      bucketId,
      fileId,
      filename: file.name,
      base64,
      contentType: file.type || 'application/octet-stream',
      permissions,
    }));

    return result.file as Models.File;
  },
  async deleteFile(bucketId: string, fileId: string) {
    unwrapResult(await window.tantalum.cloud.storage.deleteFile({ bucketId, fileId }));
  },
};

export const functions = {
  async createExecution(
    functionId: string,
    body: string,
    async = false,
    pathName = '/',
    method = 'POST',
    headers?: Record<string, string>,
  ) {
    const result = unwrapResult(await window.tantalum.cloud.functions.createExecution({
      functionId,
      body,
      async,
      pathName,
      method,
      headers,
    }));

    return result.execution as Models.Execution;
  },
};

export { ID, Permission, Query, Role };
