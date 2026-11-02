import { PayloadTooLargeException } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const exportLimits = { rows: 10000, bytes: 8 * 1024 * 1024 } as const;

export function csvCell(value: string | null | undefined): string {
  // Keep meaningful line breaks; remove other control characters before inspection.
  let text = (value ?? '').replace(
    // eslint-disable-next-line no-control-regex -- Sanitize spreadsheet input deliberately.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    '',
  );
  const inspected = text.normalize('NFKC');
  if (
    /^[\t\r\n]/.test(inspected) ||
    /^[\s\u200b-\u200f\u2060\ufeff]*[=+@-]/u.test(inspected)
  )
    // Prefix risky quoted fields with a tab for Excel's text-cell handling.
    text = `\t${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const csvRow = (cells: (string | null | undefined)[]) =>
  cells.map(csvCell).join(',') + '\r\n';

// Spool a bounded snapshot before sending headers, so failures never become successful partial CSVs.
export class CsvFile {
  private handle!: FileHandle;
  private rows = 0;
  private bytes = 0;
  private closed = false;
  private constructor(
    private readonly directory: string,
    readonly path: string,
  ) {}

  static async create() {
    const directory = await mkdtemp(join(tmpdir(), 'together-finance-export-'));
    const file = new CsvFile(directory, join(directory, 'export.csv'));
    try {
      await chmod(directory, 0o700);
      file.handle = await open(file.path, 'wx', 0o600);
      return file;
    } catch (error) {
      await file.dispose();
      throw error;
    }
  }
  async reset(headers: string[]) {
    await this.handle.truncate(0);
    this.rows = 0;
    this.bytes = 0;
    await this.write('\ufeff' + csvRow(headers));
  }
  private async write(text: string) {
    const buffer = Buffer.from(text, 'utf8');
    if (this.bytes + buffer.length > exportLimits.bytes)
      throw new PayloadTooLargeException('Narrow the export filters.');
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await this.handle.write(
        buffer,
        offset,
        buffer.length - offset,
        this.bytes + offset,
      );
      offset += bytesWritten;
    }
    this.bytes += buffer.length;
  }
  async row(cells: (string | null | undefined)[]) {
    if (++this.rows > exportLimits.rows)
      throw new PayloadTooLargeException('Narrow the export filters.');
    await this.write(csvRow(cells));
  }
  async download() {
    await this.handle.close();
    this.closed = true;
    const stream = createReadStream(this.path);
    stream.once('close', () => {
      void this.dispose();
    });
    return { stream, length: this.bytes };
  }
  async dispose() {
    if (this.handle && !this.closed) {
      this.closed = true;
      await this.handle.close().catch(() => undefined);
    }
    // Only remove this request's generated file and empty private directory.
    await unlink(this.path).catch(() => undefined);
    await rmdir(this.directory).catch(() => undefined);
  }
}
