'use strict';

// The packaged app loads this script after renderer.js. It provides the
// system-report action and the update-available confirmation prompt.
(() => {
  const about = document.querySelector('#view-help .card:last-child');
  const updateButton = document.querySelector('#btn-check-app-update');
  if (!about || !updateButton || !window.api) return;

  const mode = document.createElement('p');
  mode.className = 'muted';
  mode.setAttribute('role', 'status');
  mode.textContent = 'Checking update support…';
  updateButton.insertAdjacentElement('beforebegin', mode);

  window.api.appInfo().then((info) => {
    mode.textContent = info.appImage
      ? 'In-app updates are supported for this AppImage.'
      : 'In-app installation requires launching Atomic Helper as an AppImage; this copy opens the release page instead.';
  }).catch(() => {
    mode.textContent = 'Could not determine whether in-app updates are supported.';
  });

  const updateBannerButton = document.querySelector('#btn-update-app');
  const updateBanner = document.querySelector('#banner-update');
  const updateTitle = document.querySelector('#banner-update-title');
  const dialog = document.querySelector('#dialog');
  if (updateBannerButton && updateBanner && updateTitle && dialog) {
    let installing = false;
    let promptedVersion = null;
    let allowNextClick = false;

    const visibleVersion = () => {
      if (updateBanner.classList.contains('hidden')) return null;
      const match = updateTitle.textContent.match(/version\s+(\d+\.\d+(?:\.\d+){0,2})/i);
      return match ? match[1] : null;
    };

    const askToUpdate = (version) => new Promise((resolve) => {
      const title = dialog.querySelector('#dialog-title');
      const body = dialog.querySelector('#dialog-body');
      const okButton = dialog.querySelector('#dialog-ok');
      const cancelButton = dialog.querySelector('#dialog-cancel');
      title.textContent = `Update to version ${version}?`;
      body.textContent = 'Atomic Helper will download and install this update, then restart automatically. Save your work before continuing.';
      okButton.textContent = 'Download and update';
      okButton.classList.remove('danger');
      dialog.classList.remove('hidden');
      cancelButton.focus();

      const finish = (accepted) => {
        dialog.classList.add('hidden');
        okButton.removeEventListener('click', accept);
        cancelButton.removeEventListener('click', decline);
        document.removeEventListener('keydown', onKey);
        resolve(accepted);
      };
      const accept = () => finish(true);
      const decline = () => finish(false);
      const onKey = (event) => { if (event.key === 'Escape') decline(); };
      okButton.addEventListener('click', accept);
      cancelButton.addEventListener('click', decline);
      document.addEventListener('keydown', onKey);
    });

    const promptForUpdate = async (version) => {
      if (installing || promptedVersion === version) return;
      promptedVersion = version;
      if (!(await askToUpdate(version))) return;
      allowNextClick = true;
      updateBannerButton.click();
    };

    // renderer.js handles the banner button. Require confirmation for manual
    // clicks too, while allowing the confirmed click through to its handler.
    updateBannerButton.addEventListener('click', async (event) => {
      if (allowNextClick) {
        allowNextClick = false;
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (installing) return;
      const version = visibleVersion() || 'the latest version';
      if (!(await askToUpdate(version))) return;
      allowNextClick = true;
      updateBannerButton.click();
    }, true);

    // The existing startup/manual update check reveals the banner. Observe it
    // so the confirmation appears as soon as a new version is reported.
    const observer = new MutationObserver(() => {
      const version = visibleVersion();
      if (version) promptForUpdate(version);
    });
    observer.observe(updateBanner, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });

    // Cover the case where the update banner was already visible before this
    // observer was attached.
    const existingVersion = visibleVersion();
    if (existingVersion) promptForUpdate(existingVersion);
  }

  const button = document.createElement('button');
  button.className = 'btn';
  button.textContent = 'Export system report';
  button.style.marginTop = '0.5rem';
  const status = document.createElement('p');
  status.className = 'muted';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  button.insertAdjacentElement('afterend', status);
  updateButton.insertAdjacentElement('afterend', button);

  const bytes = (value) => {
    if (!Number.isFinite(value)) return 'unknown';
    const gb = value / 1e9;
    return `${gb.toFixed(1)} GB`;
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Preparing report…';
    try {
      const [system, app] = await Promise.all([window.api.status(), window.api.appInfo()]);
      if (!system) throw new Error('System information is unavailable.');

      const report = [
        'Atomic Helper system report',
        `Generated: ${new Date().toISOString()}`,
        `Atomic Helper version: ${app.version}`,
        `Operating system: ${system.pretty || 'unknown'}`,
        `Kernel: ${system.kernel || 'unknown'}`,
        `Atomic system: ${system.atomic ? 'yes' : 'no'}`,
        `Booted version: ${(system.booted && system.booted.version) || 'unknown'}`,
        `Pending restart: ${system.pendingReboot ? 'yes' : 'no'}`,
        `Pending version: ${system.pendingVersion || 'none'}`,
        `Rollback available: ${system.rollbackAvailable ? 'yes' : 'no'}`,
        `Storage: ${bytes(system.freeBytes)} free of ${bytes(system.totalBytes)}`,
        `Layered packages: ${(system.layered || []).length ? system.layered.join(', ') : 'none'}`,
        '',
        'This report contains system version and package information only; it is not sent anywhere automatically.',
      ].join('\n');

      const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `atomic-helper-report-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'System report downloaded.';
    } catch (error) {
      status.textContent = `Could not create report: ${error.message || error}`;
    } finally {
      button.disabled = false;
    }
  });
})();
