/**
 * Encerra processos que estão em LISTEN na porta da UI (ex.: instância anterior do collector).
 * Windows + macOS/Linux. Não mata o processo atual.
 */

import { execSync, spawnSync } from 'child_process';

function killPidWindows(pid: number): void {
  if (pid === process.pid || pid <= 0) return;
  try {
    execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
  } catch {
    /* processo já sumiu ou sem permissão */
  }
}

function killPidUnix(pid: number): void {
  if (pid === process.pid || pid <= 0) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    try {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    } catch {
      /* */
    }
  }
}

/** Extrai PID de linhas do netstat (Windows). */
function pidsFromNetstat(port: number, skipPid: number): Set<number> {
  const pids = new Set<number>();
  let out: string;
  try {
    out = execSync('netstat -ano', { encoding: 'utf-8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  } catch {
    return pids;
  }
  const listening = /LISTENING|OUÇÃO|ESCUTA/i;
  for (const line of out.split(/\r?\n/)) {
    if (!listening.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0] !== 'TCP') continue;
    const local = parts[1] ?? '';
    const state = parts[3] ?? '';
    const pidStr = parts[parts.length - 1];
    if (!/LISTENING|OUÇÃO|ESCUTA/i.test(state)) continue;
    const m = local.match(/:(\d+)$/);
    if (!m) continue;
    if (parseInt(m[1], 10) !== port) continue;
    const pid = parseInt(pidStr, 10);
    if (Number.isFinite(pid) && pid !== skipPid) pids.add(pid);
  }
  return pids;
}

function freePortWindows(port: number): void {
  const skip = process.pid;
  spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -ne ${skip}) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }`,
    ],
    { stdio: 'ignore', windowsHide: true, timeout: 15000 }
  );
  for (const pid of pidsFromNetstat(port, skip)) {
    killPidWindows(pid);
  }
}

function freePortUnix(port: number): void {
  const skip = process.pid;
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 256 * 1024,
    });
    for (const line of out.trim().split(/\n/)) {
      const pid = parseInt(line.trim(), 10);
      if (Number.isFinite(pid) && pid !== skip) killPidUnix(pid);
    }
  } catch {
    /* nada escutando ou sem lsof */
  }
}

/**
 * Libera a porta antes de o servidor HTTP subir.
 */
export function freePortForUi(port: number): void {
  if (!Number.isFinite(port) || port < 1 || port > 65535) return;
  if (process.platform === 'win32') {
    freePortWindows(port);
  } else {
    freePortUnix(port);
  }
}
