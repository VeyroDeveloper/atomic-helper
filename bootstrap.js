'use strict';

// Register the Firejail bridge before loading the existing Electron app so the
// renderer's narrow preload API can invoke only typed Rust operations.
const { ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function backendPath() {
  const packaged = path.join(process.resourcesPath, 'app', 'bin', 'atomic-helper-firejail');
  const candidates = [packaged, path.join(__dirname, 'target', 'release', 'atomic-helper-firejail')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function callRust(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(backendPath(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) { settled = true; reject(new Error('The sandbox helper timed out.')); }
    }, 15000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (part) => { stdout += part; if (stdout.length > 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', (part) => { stderr += part; if (stderr.length > 64 * 1024) child.kill('SIGKILL'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) { settled = true; reject(new Error(error.code === 'ENOENT' ? 'The Rust sandbox helper is missing. Build the project with ./build.sh.' : error.message)); }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try {
        const result = JSON.parse(stdout);
        if (code !== 0 || !result.ok) reject(new Error(result.error || stderr.trim() || 'The sandbox helper failed.'));
        else resolve(result.data);
      } catch (error) {
        reject(new Error(stderr.trim() || `The Rust sandbox helper returned invalid data (exit ${code}).`));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

ipcMain.handle('firejail:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose an app to sandbox',
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['appimage', 'bin', 'run', ''] }],
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('firejail:status', () => callRust({ command: 'status' }));
ipcMain.handle('firejail:analyze', (_event, file) => callRust({ command: 'analyze', file }));
ipcMain.handle('firejail:preview', (_event, file, options) => callRust({ command: 'preview', file, options }));
ipcMain.handle('firejail:launch', (_event, file, options) => callRust({ command: 'launch', file, options }));

require('./main.js');
