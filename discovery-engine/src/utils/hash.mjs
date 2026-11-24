import crypto from 'node:crypto';
import fs from 'node:fs';

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}
