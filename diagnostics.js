'use strict';

// The packaged app loads this script after renderer.js. The report is assembled
// on demand and stays on the user's machine unless they choose to share it.
(() => {
  const about = document.querySelector('#view-help .card:last-child');
  const updateButton = document.querySelector('#btn-check-app-update');
  if (!about || !updateButton || !window.api) return;

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
