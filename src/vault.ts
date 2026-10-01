import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, unlink, chmod} from 'node:fs/promises';
import {join} from 'node:path';

/** A single-owner, local encrypted store. File names are internal, never user supplied. */
export class Vault {
  private key!: Buffer;
  private queue: Promise<void> = Promise.resolve();
  constructor(readonly directory: string) {}
  async init(): Promise<void> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    await chmod(this.directory, 0o700);
    try {this.key = await readFile(join(this.directory, 'vault.key'));}
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.key = randomBytes(32);
      try {await writeFile(join(this.directory, 'vault.key'), this.key, {mode: 0o600, flag: 'wx'});}
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        this.key = await readFile(join(this.directory, 'vault.key'));
      }
    }
    if (this.key.length !== 32) throw new Error('The local encryption key is invalid. Restore your .data backup.');
  }
  private path(name: string): string {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid store name.');
    return join(this.directory, `${name}.enc`);
  }
  async read<T>(name: string): Promise<T | null> {
    await this.queue;
    let packed: Buffer;
    try {packed = await readFile(this.path(name));}
    catch (e) {if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e;}
    if (packed.length < 29 || packed[0] !== 1) throw new Error('Local data is damaged; no data has been overwritten.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, packed.subarray(1, 13));
    decipher.setAuthTag(packed.subarray(13, 29));
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(29)), decipher.final()]).toString()) as T;
  }
  async write(name: string, value: unknown): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const packed = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
    const path = this.path(name);
    const work = this.queue.then(async () => {
      const temp = `${path}.tmp`;
      await writeFile(temp, packed, {mode: 0o600});
      await rename(temp, path);
    });
    this.queue = work.catch(() => {});
    await work;
  }
  async remove(name: string): Promise<void> {
    const work = this.queue.then(async () => {
      try {await unlink(this.path(name));}
      catch (e) {if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;}
    });
    this.queue = work.catch(() => {});
    await work;
  }
}
