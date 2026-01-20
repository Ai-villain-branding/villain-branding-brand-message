/**
 * Cleanup Utility
 * Handles cleanup of temporary resources like browser user data directories
 */

const fs = require('fs');
const path = require('path');

class CleanupUtil {
    /**
     * Clean up old Playwright user data directories
     * These are created by standaloneScreenshotService for extension support
     */
    static async cleanupOldUserDataDirs(maxAgeMinutes = 60) {
        try {
            const tmpDir = '/tmp';
            const prefix = 'playwright-user-data-';
            
            if (!fs.existsSync(tmpDir)) {
                return { cleaned: 0, errors: 0 };
            }

            const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
            let cleaned = 0;
            let errors = 0;
            const now = Date.now();
            const maxAgeMs = maxAgeMinutes * 60 * 1000;

            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith(prefix)) {
                    const dirPath = path.join(tmpDir, entry.name);
                    
                    try {
                        const stats = fs.statSync(dirPath);
                        const age = now - stats.mtimeMs;

                        // Only clean up directories older than maxAge
                        if (age > maxAgeMs) {
                            fs.rmSync(dirPath, { recursive: true, force: true });
                            cleaned++;
                            console.log(`[Cleanup] Removed old user data dir: ${entry.name} (age: ${Math.round(age / 60000)}min)`);
                        }
                    } catch (error) {
                        errors++;
                        console.warn(`[Cleanup] Failed to remove ${entry.name}:`, error.message);
                    }
                }
            }

            if (cleaned > 0 || errors > 0) {
                console.log(`[Cleanup] Summary: ${cleaned} directories cleaned, ${errors} errors`);
            }

            return { cleaned, errors };
        } catch (error) {
            console.error('[Cleanup] Error during cleanup:', error.message);
            return { cleaned: 0, errors: 1 };
        }
    }

    /**
     * Start periodic cleanup (runs every hour by default)
     */
    static startPeriodicCleanup(intervalMinutes = 60, maxAgeMinutes = 60) {
        console.log(`[Cleanup] Starting periodic cleanup (every ${intervalMinutes}min, max age ${maxAgeMinutes}min)`);
        
        // Run immediately on start
        this.cleanupOldUserDataDirs(maxAgeMinutes);

        // Then run periodically
        const intervalMs = intervalMinutes * 60 * 1000;
        const cleanupInterval = setInterval(() => {
            this.cleanupOldUserDataDirs(maxAgeMinutes);
        }, intervalMs);

        // Return interval ID so it can be cleared if needed
        return cleanupInterval;
    }

    /**
     * Clean up a specific user data directory immediately
     */
    static async cleanupUserDataDir(dirPath) {
        try {
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                console.log(`[Cleanup] Removed user data dir: ${dirPath}`);
                return true;
            }
            return false;
        } catch (error) {
            console.warn(`[Cleanup] Failed to remove ${dirPath}:`, error.message);
            return false;
        }
    }
}

module.exports = CleanupUtil;
