import { createHash } from 'crypto';
import { createReadStream } from 'fs';

/**
 * SHA-256 of a file's bytes, streamed so a large upload never lands in memory
 * twice. Identifies identical content across different filenames — the "(1)"
 * copy a browser download leaves behind is the same document to the indexer.
 */
export function hashFileContent(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
