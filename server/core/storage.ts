import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';

export class LocalDiskStorage {
  private readonly baseDir: string;

  constructor(baseDir: string = config.localStorageDir) {
    this.baseDir = baseDir;
  }

  public getStoragePath(userId: string, documentId: string, ext: string): string {
    return `${userId}/${documentId}/original.${ext}`;
  }

  public resolveAbsolutePath(storagePath: string): string {
    const resolved = path.resolve(this.baseDir, storagePath);
    if (!resolved.startsWith(this.baseDir)) {
      throw new Error('Invalid storage path traversal attempt');
    }
    return resolved;
  }

  public async saveFile(storagePath: string, buffer: Buffer): Promise<void> {
    const absPath = this.resolveAbsolutePath(storagePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);
  }

  public async readFile(storagePath: string): Promise<Buffer> {
    const absPath = this.resolveAbsolutePath(storagePath);
    return fs.readFile(absPath);
  }

  public async deleteFile(storagePath: string): Promise<void> {
    const absPath = this.resolveAbsolutePath(storagePath);
    try {
      await fs.rm(path.dirname(absPath), { recursive: true, force: true });
    } catch {
      // Ignore if already removed
    }
  }

  public async healthCheck(): Promise<boolean> {
    await fs.mkdir(this.baseDir, { recursive: true });
    return true;
  }
}

export const storage = new LocalDiskStorage();
