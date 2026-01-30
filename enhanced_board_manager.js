// Enhanced Board Manager UI Functions
async function searchBoardPlatforms(query) {
    const listContainer = document.getElementById('bm-list');
    listContainer.innerHTML = '<div class="empty-state"><p>Searching...</p></div>';

    try {
        // Run search and list installed in parallel
        const [searchResult, installedResult] = await Promise.all([
            window.api.searchBoardPlatforms(query),
            window.api.listInstalledPlatforms()
        ]);

        // Build a map of installed platforms for quick lookup
        const installedMap = new Map();
        if (installedResult.success) {
            installedResult.platforms.forEach(p => {
                installedMap.set(p.id, p.version);
            });
        }

        listContainer.innerHTML = '';

        if (searchResult.success && searchResult.platforms.length > 0) {
            searchResult.platforms.forEach(platform => {
                const item = document.createElement('div');
                item.className = 'list-item enhanced-board-item';
                const installedVersion = installedMap.get(platform.id);
                const isInstalled = !!installedVersion;

                // Determine button state
                let actionButton;
                if (isInstalled) {
                    if (installedVersion !== platform.latest) {
                        actionButton = `<button class="btn-xs primary" onclick="installPlatformHelper('${escapeHtml(platform.id)}', '${platform.latest}')">UPDATE</button>
                           <button class="btn-xs secondary" onclick="removePlatformHelper('${escapeHtml(platform.id)}')">REMOVE</button>`;
                    } else {
                        actionButton = `<button class="btn-xs secondary" onclick="removePlatformHelper('${escapeHtml(platform.id)}')">REMOVE</button>`;
                    }
                } else {
                    actionButton = `<button class="btn-xs primary" onclick="installPlatformHelper('${escapeHtml(platform.id)}', '${platform.latest}')">INSTALL</button>`;
                }

                const versionBadge = isInstalled
                    ? `<span class="version-badge installed">${installedVersion} installed</span>`
                    : '';

                item.innerHTML = `
          <div class="list-item-header">
            <div>
              <span class="list-item-title">${escapeHtml(platform.name || platform.id)}</span>
              <span class="list-item-author">by Arduino</span>
            </div>
            ${versionBadge}
          </div>
          <p class="list-item-desc">ID: ${platform.id}</p>
          <div class="list-item-actions">
            <select class="version-select" onchange="updatePlatformVersionHelper('${escapeHtml(platform.id)}', this.value)">
              <option value="${platform.latest}">${platform.latest}</option>
            </select>
            ${actionButton}
          </div>
        `;
                listContainer.appendChild(item);
            });
        } else {
            listContainer.innerHTML = '<div class="empty-state"><p>No board platforms found</p></div>';
        }
    } catch (error) {
        console.error('Platform search error:', error);
        listContainer.innerHTML = '<div class="empty-state"><p>Error searching platforms</p></div>';
    }
}

async function installPlatformHelper(id, version) {
    showToast(`Installing ${id}... this may take several minutes`, 'info');
    consoleLog(`Installing board core: ${id}@${version}...`, 'info');
    consoleLog('Note: ESP32 cores are large (~250MB) and may take time to download', 'info');

    try {
        // using existing generic install handler
        const result = await window.api.installBoardPackage({ packageName: id });

        if (result.success) {
            showToast(`${id} installed!`, 'success');
            consoleLog(`✓ ${id} installed successfully`, 'success');
            // Refresh the board list to show updated status
            searchBoardPlatforms(document.getElementById('bm-search').value || '');
        } else {
            showToast(`Failed to install ${id}`, 'error');
            consoleLog(`✗ Failed to install ${id}: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Error installing ${id}`, 'error');
        consoleLog(`✗ Error: ${error.message}`, 'error');
    }
}

async function removePlatformHelper(id) {
    if (!confirm(`Are you sure you want to remove ${id}?`)) return;

    showToast(`Removing ${id}...`, 'info');
    consoleLog(`Removing board core: ${id}...`, 'info');

    // TODO: Implement remove functionality via arduino-cli
    showToast('Remove functionality coming soon', 'warning');
}

function updatePlatformVersionHelper(id, version) {
    // Version selection changed - could trigger install of specific version
    console.log(`Version changed for ${id}: ${version}`);
}

window.installPlatformHelper = installPlatformHelper;
window.removePlatformHelper = removePlatformHelper;
window.updatePlatformVersionHelper = updatePlatformVersionHelper;
