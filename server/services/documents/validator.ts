import crypto from 'node:crypto';
import JSZip from 'jszip';
import { config } from '../../core/config.ts';
import { AppError } from '../../core/errors.ts';

export type AllowedExt = 'pdf' | 'docx' | 'pptx' | 'txt';

export interface ValidatedUpload {
  ext: AllowedExt;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  buffer: Buffer;
}

const MIME_MAP: Record<AllowedExt, string[]> = {
  pdf: ['application/pdf'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream',
  ],
  txt: ['text/plain', 'text/markdown', 'application/octet-stream'],
};

export async function validateUploadBuffer(params: {
  originalFilename: string;
  declaredMime: string;
  buffer: Buffer;
}): Promise<ValidatedUpload> {
  const { originalFilename, declaredMime, buffer } = params;

  if (buffer.length === 0) {
    throw new AppError(422, 'EMPTY_FILE', 'Uploaded file is empty (0 bytes).');
  }

  if (buffer.length > config.maxUploadBytes) {
    throw new AppError(
      413,
      'FILE_TOO_LARGE',
      `File exceeds the ${config.maxUploadMb} MB maximum upload limit.`,
      { max_upload_mb: config.maxUploadMb, size_bytes: buffer.length },
    );
  }

  const extMatch = originalFilename.toLowerCase().match(/\.([a-z0-9]+)$/);
  const rawExt = extMatch?.[1] || '';
  if (!['pdf', 'docx', 'pptx', 'txt'].includes(rawExt)) {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Unsupported file extension. Allowed formats: PDF, DOCX, PPTX, TXT.',
      { allowed: ['pdf', 'docx', 'pptx', 'txt'] },
    );
  }
  const ext = rawExt as AllowedExt;

  const cleanMime = (declaredMime || '').split(';')[0].trim().toLowerCase();
  if (cleanMime && !MIME_MAP[ext].includes(cleanMime)) {
    throw new AppError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Declared MIME type '${cleanMime}' does not match .${ext} file format.`,
    );
  }

  // Magic-byte & container verification
  if (ext === 'pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'File signature does not match a valid PDF document.',
      );
    }
  } else if (ext === 'docx' || ext === 'pptx') {
    const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (!isZip) {
      throw new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        `File signature does not match a valid .${ext} archive.`,
      );
    }
    try {
      const zip = await JSZip.loadAsync(buffer);
      const requiredEntry = ext === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml';
      if (!zip.file(requiredEntry)) {
        throw new AppError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          `Archive is missing required ${ext.toUpperCase()} structure.`,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', `Corrupt or invalid .${ext} file.`);
    }
  } else if (ext === 'txt') {
    if (buffer.includes(0x00)) {
      throw new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Binary content detected inside .txt upload.',
      );
    }
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    ext,
    mimeType:
      ext === 'pdf'
        ? 'application/pdf'
        : ext === 'docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : ext === 'pptx'
            ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            : 'text/plain',
    sizeBytes: buffer.length,
    sha256,
    buffer,
  };
}
