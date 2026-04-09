const env = import.meta.env;

function readConfig(name: string, fallback = '') {
  const value = env[name as keyof ImportMetaEnv];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export const appwriteConfig = {
  endpoint: readConfig('VITE_APPWRITE_ENDPOINT', 'https://sgp.cloud.appwrite.io/v1'),
  projectId: readConfig('VITE_APPWRITE_PROJECT_ID', '697b8f42002a34ba04b3'),
  databaseId: readConfig('VITE_APPWRITE_DATABASE_ID', '697b8f660033fffde4be'),
  boardsCollectionId: readConfig('VITE_APPWRITE_BOARDS_COLLECTION_ID', 'boards'),
  firmwareCollectionId: readConfig('VITE_APPWRITE_FIRMWARE_COLLECTION_ID', 'firmwares'),
  sketchesCollectionId: readConfig('VITE_APPWRITE_SKETCHES_COLLECTION_ID', 'sketches'),
  firmwareBucketId: readConfig('VITE_APPWRITE_FIRMWARE_BUCKET_ID', 'firmware_bucket'),
  boardAdminFunctionId: readConfig('VITE_APPWRITE_BOARD_ADMIN_FUNCTION_ID'),
  deviceGatewayFunctionId: readConfig('VITE_APPWRITE_DEVICE_GATEWAY_FUNCTION_ID'),
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
