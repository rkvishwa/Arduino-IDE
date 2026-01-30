/**
 * Authentication Service
 * Handles user registration, login, logout, and session management
 */

const { account, ID } = require('../config/appwriteConfig');

class AuthService {
    /**
     * Register a new user account
     * @param {string} email - User email
     * @param {string} password - User password (min 8 characters)
     * @param {string} name - Display name
     * @returns {Promise<Object>} Created user object
     */
    async register(email, password, name) {
        try {
            const user = await account.create(ID.unique(), email, password, name);
            // Auto-login after registration
            await this.login(email, password);
            return { success: true, user };
        } catch (error) {
            console.error('Registration error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Login with email and password
     * @param {string} email - User email
     * @param {string} password - User password
     * @returns {Promise<Object>} Session object
     */
    async login(email, password) {
        try {
            // Try new method first, then fallback to old method
            if (typeof account.createEmailPasswordSession === 'function') {
                const session = await account.createEmailPasswordSession(email, password);
                return { success: true, session };
            } else if (typeof account.createEmailSession === 'function') {
                const session = await account.createEmailSession(email, password);
                return { success: true, session };
            } else {
                console.error('Available account keys:', Object.keys(account));
                console.error('Account prototype:', Object.getPrototypeOf(account));
                throw new Error('No login method found on Account object');
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Logout current user
     * @returns {Promise<Object>} Success status
     */
    async logout() {
        try {
            await account.deleteSession('current');
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get currently logged in user
     * @returns {Promise<Object|null>} User object or null
     */
    async getCurrentUser() {
        try {
            const user = await account.get();
            return { success: true, user };
        } catch (error) {
            // User not logged in
            return { success: false, user: null };
        }
    }

    /**
     * Check if user is authenticated
     * @returns {Promise<boolean>}
     */
    async isAuthenticated() {
        const result = await this.getCurrentUser();
        return result.success && result.user !== null;
    }

    /**
     * Update user preferences
     * @param {Object} prefs - Preferences object
     * @returns {Promise<Object>}
     */
    async updatePreferences(prefs) {
        try {
            const user = await account.updatePrefs(prefs);
            return { success: true, user };
        } catch (error) {
            console.error('Update preferences error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Request password recovery
     * @param {string} email - User email
     * @param {string} redirectUrl - URL to redirect after recovery
     * @returns {Promise<Object>}
     */
    async requestPasswordRecovery(email, redirectUrl) {
        try {
            await account.createRecovery(email, redirectUrl);
            return { success: true };
        } catch (error) {
            console.error('Password recovery error:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new AuthService();
