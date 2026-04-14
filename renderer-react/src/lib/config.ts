import type { CloudConfig } from '@/types/electron';

const env = import.meta.env;
const desktopCloudConfig: Partial<CloudConfig> = (
  window as typeof window & {
    tantalum?: {
      app?: {
        cloudConfig?: Partial<CloudConfig>;
      };
    };
  }
).tantalum?.app?.cloudConfig ?? {};

function readConfig(name: string, fallback = '') {
  const value = env[name as keyof ImportMetaEnv];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export const appwriteConfig = {
  endpoint: readConfig('VITE_APPWRITE_ENDPOINT', desktopCloudConfig.endpoint ?? ''),
  projectId: readConfig('VITE_APPWRITE_PROJECT_ID', desktopCloudConfig.projectId ?? ''),
  databaseId: readConfig('VITE_APPWRITE_DATABASE_ID', desktopCloudConfig.databaseId ?? ''),
  boardsCollectionId: readConfig('VITE_APPWRITE_BOARDS_COLLECTION_ID', desktopCloudConfig.boardsCollectionId ?? ''),
  firmwareCollectionId: readConfig('VITE_APPWRITE_FIRMWARE_COLLECTION_ID', desktopCloudConfig.firmwareCollectionId ?? ''),
  sketchesCollectionId: readConfig('VITE_APPWRITE_SKETCHES_COLLECTION_ID', desktopCloudConfig.sketchesCollectionId ?? ''),
  agentSettingsCollectionId: readConfig('VITE_APPWRITE_AGENT_SETTINGS_COLLECTION_ID', desktopCloudConfig.agentSettingsCollectionId ?? ''),
  firmwareBucketId: readConfig('VITE_APPWRITE_FIRMWARE_BUCKET_ID', desktopCloudConfig.firmwareBucketId ?? ''),
  boardAdminFunctionId: readConfig('VITE_APPWRITE_BOARD_ADMIN_FUNCTION_ID', desktopCloudConfig.boardAdminFunctionId ?? ''),
  deviceGatewayFunctionId: readConfig('VITE_APPWRITE_DEVICE_GATEWAY_FUNCTION_ID', desktopCloudConfig.deviceGatewayFunctionId ?? ''),
  proxyAiRequestFunctionId: readConfig('VITE_APPWRITE_PROXY_AI_REQUEST_FUNCTION_ID', desktopCloudConfig.proxyAiRequestFunctionId ?? ''),
};

export function hasRequiredCloudConfiguration() {
  return [
    appwriteConfig.endpoint,
    appwriteConfig.projectId,
    appwriteConfig.databaseId,
    appwriteConfig.boardsCollectionId,
    appwriteConfig.firmwareCollectionId,
    appwriteConfig.firmwareBucketId,
  ].every((value) => value.length > 0);
}

export function hasBoardAdminFunction() {
  return appwriteConfig.boardAdminFunctionId.length > 0;
}

export function hasDeviceGatewayFunction() {
  return appwriteConfig.deviceGatewayFunctionId.length > 0;
}

export function hasAgentSettingsCollection() {
  return appwriteConfig.agentSettingsCollectionId.length > 0;
}

export function hasProxyAiFunction() {
  return appwriteConfig.proxyAiRequestFunctionId.length > 0;
}

export function hasAgentCloudConfiguration() {
  return [
    appwriteConfig.endpoint,
    appwriteConfig.projectId,
    appwriteConfig.databaseId,
    appwriteConfig.agentSettingsCollectionId,
    appwriteConfig.proxyAiRequestFunctionId,
  ].every((value) => value.length > 0);
}
