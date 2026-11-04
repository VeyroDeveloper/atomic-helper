'use strict';

// The packaged app loads this script after renderer.js. The report is assembled
// on demand and stays on the user's machine unless they choose to share it.
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

  // Intercept the update action to confirm the target version before starting
  // the existing download/install flow. This listener runs in capture phase so
  // renderer.js's direct click handler does not start a download prematurely.
  const updateBannerButton = document.querySelector('#btn-update-app');
  const dialog = document.querySelector('#dialog');
  if (updateBannerButton && dialog) {
    let installing = false;

    const askToUpdate = (version) => new Promise((resolve) => {
      const title = dialog.querySelector('#dialog-title');
      const body = dialog.querySelector('#dialog-body');
      const okButton = dialog.querySelector('#dialog-ok');
      const cancelButton = dialog.querySelector('#dialog-cancel');
      title.textContent = `Update to version ${version}?`;
      body.textContent = 'Atomic Helper will download and install this update, then restart automatically. You can save your work before continuing.';
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

    updateBannerButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (installing) return;

      const statusText = document.querySelector('#about-update')?.textContent || '';
      const bannerText = document.querySelector('#banner-update-title')?.textContent || '';
      const match = `${statusText} ${bannerText}`.match(/(?:version\s+|:\s*v?)(\d+\.\d+(?:\.\d+){0,2})/i);
      const version = match ? match[1] : 'the latest version';
      if (!(await askToUpdate(version))) return;

      installing = true;
      const subtitle = document.querySelector('#banner-update-sub');
      const cancel = document.querySelector('#btn-update-later');
      updateBannerButton.disabled = true;
      if (cancel) cancel.disabled = true;
      if (subtitle) subtitle.textContent = 'Downloading…';

      const off = window.api.onUpdateProgress((pct) => {
        if (subtitle && pct != null) subtitle.textContent = `Downloading… ${pct}%`;
      });
      let result;
      try {
        result = await window.api.appUpdateInstall();
      } catch (error) {
        result = { ok: false, message: String(error && error.message ? error.message : error) };
      } finally {
        off();
      }

      if (result.ok && result.restarting) {
        if (subtitle) subtitle.textContent = 'Installed. Restarting…';
        return;
      }
      installing = false;
      updateBannerButton.disabled = false;
      if (cancel) cancel.disabled = false;
      if (subtitle) subtitle.textContent = result.ok
        ? 'The release page was opened in your browser.'
        : `Update failed: ${result.message}`;
    }, true);
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
