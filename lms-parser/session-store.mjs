import {spawn} from 'node:child_process';
import {mkdir, readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {LmsError} from './errors.mjs';

const limit = 16 * 1024 * 1024;
const storageError = () => new LmsError('SESSION_STORAGE', '이 PC에 로그인 상태를 보관하지 못했습니다.');

// Only encrypted bytes touch disk. Both directions use private stdin/stdout
// pipes; credentials never appear in command arguments, error output or logs.
export function protectForCurrentUser(input, decrypt = false) {
  if (process.platform !== 'win32') return Promise.reject(storageError());
  const script = `$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
  $result = [Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 1 }`;
  return new Promise((resolve, reject) => {
    const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {windowsHide: true, stdio: ['pipe', 'pipe', 'ignore']});
    const chunks = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(storageError()); }, 15000);
    child.on('error', () => { clearTimeout(timer); reject(storageError()); });
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > limit * 2) { child.kill(); reject(storageError()); }
      else chunks.push(chunk);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(storageError());
      const encoded = Buffer.concat(chunks).toString('ascii').trim();
      if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return reject(storageError());
      resolve(Buffer.from(encoded, 'base64'));
    });
    child.stdin.end(Buffer.from(input).toString('base64'));
  });
}

export class SessionStore {
  constructor({directory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'SSU LMS Moa'),
    protect = protectForCurrentUser, supported = process.platform === 'win32'} = {}) {
    this.directory = directory;
    this.filename = path.join(directory, 'login.dpapi');
    this.protect = protect; this.supported = supported; this.pending = Promise.resolve();
  }

  async load() {
    await this.pending;
    if (!this.supported) return null;
    let encrypted;
    try { encrypted = await readFile(this.filename); }
    catch (error) { if (error.code === 'ENOENT') return null; throw storageError(); }
    try {
      if (encrypted.length > limit) throw storageError();
      const parsed = JSON.parse((await this.protect(encrypted, true)).toString('utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.state?.cookies) || !Array.isArray(parsed.state?.origins)) throw storageError();
      return parsed.state;
    } catch { throw storageError(); }
  }

  save(state) {
    const operation = this.pending.then(async () => {
      if (!this.supported) throw storageError();
      let temporary;
      try {
        const data = Buffer.from(JSON.stringify({version: 1, state}));
        if (data.length > limit / 2) throw storageError();
        const encrypted = await this.protect(data);
        await mkdir(this.directory, {recursive: true, mode: 0o700});
        temporary = path.join(this.directory, `login-${randomUUID()}.tmp`);
        await writeFile(temporary, encrypted, {flag: 'wx', mode: 0o600});
        await rename(temporary, this.filename);
      } catch { throw storageError(); }
      finally { if (temporary) await unlink(temporary).catch(() => {}); }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  clear() {
    const operation = this.pending.then(async () => {
      try { await unlink(this.filename); }
      catch (error) { if (error.code !== 'ENOENT') throw storageError(); }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
