import { createServer, type Server } from 'net';
import { promises as fs } from 'fs';

export const NATIVE_IPC_DIR = '/tmp/homeback-remote-ipc';
export const NATIVE_EVENT_SOCKET = `${NATIVE_IPC_DIR}/events.sock`;
export const NATIVE_LEASE_FILE = `${NATIVE_IPC_DIR}/lease`;
const LEASE_PERIOD_MS = 400;
const MAX_EVENT_BYTES = 128;

/**
 * InputHook++ publishes only natively swallowed, service-owned key states.
 *
 * This channel does not read /dev/input, hook LG processes, or execute actions.
 * Linux filesystem permissions isolate it to root, and the on-disk lease is
 * renewed on the Node event loop. An absent receiver or stale lease makes the
 * native hook PASS its keys instead of trapping the remote.
 */
export class NativeRemoteChannel {
  public constructor(private readonly runtimeDir = NATIVE_IPC_DIR) {}
  private get eventSocket(): string { return `${this.runtimeDir}/events.sock`; }
  private get leasePath(): string { return `${this.runtimeDir}/lease`; }

  private server: Server | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private leaseInFlight = false;
  private authorized = false;
  private listening = false;
  private received = 0;
  private rejected = 0;

  public get ready(): boolean { return this.listening; }
  public get deliveredEvents(): number { return this.received; }
  public get rejectedEvents(): number { return this.rejected; }

  public async start(onEvent: (keycode: number, state: number) => void): Promise<void> {
    if (this.server) return;
    await fs.mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.runtimeDir, 0o700);
    try {
      const existing = await fs.lstat(this.eventSocket);
      if (!existing.isSocket()) throw new Error('Native IPC path exists but is not a socket');
      try {
        const lease = await fs.stat(this.leasePath);
        if (Date.now() - lease.mtimeMs < 2_000 && lease.mtimeMs <= Date.now() + 1_000) {
          throw new Error('A live HomeBack remote-event listener already owns this socket');
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      await fs.unlink(this.eventSocket);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    this.server = createServer(socket => {
      socket.setEncoding('utf8');
      let carry = '';
      socket.on('data', (data: string | Buffer) => {
        carry += data.toString();
        if (carry.length > MAX_EVENT_BYTES) {
          this.rejected += 1;
          socket.destroy();
          return;
        }
        let cut: number;
        while ((cut = carry.indexOf('\n')) >= 0) {
          const line = carry.slice(0, cut);
          carry = carry.slice(cut + 1);
          const match = /^(0|[1-9]\d{0,9}) ([012])$/.exec(line);
          if (!match) { this.rejected += 1; continue; }
          const keycode = Number(match[1]);
          if (keycode > 0x7fffffff) { this.rejected += 1; continue; }
          this.received += 1;
          onEvent(keycode, Number(match[2]));
        }
      });
      socket.on('error', error => {
        this.rejected += 1;
        console.warn('Native remote event client error:', error);
      });
    });
    this.server.on('error', error => console.error('Native remote listener error:', error));
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(this.eventSocket, () => {
          this.server!.off('error', reject);
          resolve();
        });
      });
      await fs.chmod(this.eventSocket, 0o600);
      this.listening = true;
      console.log('HomeBack structured native remote events listening');
    } catch (error) {
      const failed = this.server;
      this.server = null;
      failed?.close();
      throw error;
    }
  }

  public async setAuthorized(authorized: boolean): Promise<void> {
    if (!authorized || !this.listening) {
      this.authorized = false;
      if (this.leaseTimer) clearInterval(this.leaseTimer);
      this.leaseTimer = null;
      await fs.unlink(this.leasePath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      return;
    }
    if (!this.authorized) {
      this.authorized = true;
      await this.refreshLease();
      this.leaseTimer = setInterval(() => {
        void this.refreshLease().catch(error => {
          console.error('Native remote lease renewal failed:', error);
          // A stale lease makes native mappings pass through automatically.
        });
      }, LEASE_PERIOD_MS);
    }
  }

  private async refreshLease(): Promise<void> {
    if (this.leaseInFlight || !this.authorized || !this.listening) return;
    this.leaseInFlight = true;
    const temporary = `${this.leasePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, `${process.pid}\n`, { mode: 0o600 });
      if (this.authorized && this.listening) await fs.rename(temporary, this.leasePath);
      else await fs.unlink(temporary).catch(() => undefined);
    } finally {
      this.leaseInFlight = false;
    }
  }

  public async stop(): Promise<void> {
    await this.setAuthorized(false);
    this.listening = false;
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.unlink(this.eventSocket).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
