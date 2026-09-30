import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export async function localProcess(command: string, args: string[], input: unknown, signal: AbortSignal): Promise<Record<string, any>> {
  signal.throwIfAborted();
  return new Promise((res, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const stop = () => { child.kill(); reject(new Error('Local adapter cancelled or timed out')); };
    signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.length > 2000000) { child.kill(); reject(new Error('Local adapter output limit exceeded')); }
    });
    child.stderr.resume(); // Adapter errors are named blockers, never raw stderr containing private data.
    child.on('error', () => { signal.removeEventListener('abort', stop); reject(new Error('Local adapter executable unavailable')); });
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (code) {
        let kind = 'unavailable';
        try { const parsed = JSON.parse(output); if (/^[A-Za-z0-9_]+$/.test(parsed.error)) kind = parsed.error; } catch { /* Raw adapter output is private. */ }
        reject(new Error(`Local adapter failed (${kind}); check configured runtime and selected files`)); return;
      }
      try { res(JSON.parse(output)); } catch { reject(new Error('Local adapter returned invalid JSON')); }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}

export function pythonAdapter(input: unknown, signal: AbortSignal) {
  return localProcess(process.env.HANJRA_PYTHON || 'python', [resolve(process.cwd(), 'scripts', 'hanjra-local.py')], input, signal);
}

export function sapiAdapter(input: unknown, signal: AbortSignal) {
  return localProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve(process.cwd(), 'scripts', 'hanjra-sapi.ps1')], input, signal);
}
