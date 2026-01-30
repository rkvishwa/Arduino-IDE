/**
 * Appwrite Configuration
 * Configure your Appwrite project settings here
 */

const { Client, Account, Databases, Storage, ID, Query } = require('appwrite');

// =============================================================================
// APPWRITE CONFIGURATION - UPDATE THESE VALUES
// =============================================================================

const APPWRITE_CONFIG = {
    // Appwrite endpoint - use Appwrite Cloud or your self-hosted instance
    endpoint: 'https://sgp.cloud.appwrite.io/v1',

    // Your Appwrite Project ID
    projectId: '697b8f42002a34ba04b3',

    // Database ID (create in Appwrite Console)
    databaseId: '697b8f660033fffde4be',

    // Collection IDs
    collections: {
        boards: 'boards',
        firmwares: 'firmwares',
        sketches: 'sketches'
    },

    // Storage Bucket ID for firmware files
    firmwareBucketId: 'firmware_bucket'
};

// =============================================================================
// APPWRITE CLIENT INITIALIZATION
// =============================================================================

const client = new Client();

client
    .setEndpoint(APPWRITE_CONFIG.endpoint)
    .setProject(APPWRITE_CONFIG.projectId);

// Initialize services
const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    client,
    account,
    databases,
    storage,
    ID,
    Query,
    APPWRITE_CONFIG
};
