// -----------------------------------------------------------------------------
// Which unread SMS already fired the "SMS received" trigger.
//
// Kept in /data (the only writable path of the container) so a restart does
// not fire the same message twice when "mark as read" is off. On the very
// first run there is no file yet: the messages already waiting in the inbox
// are recorded WITHOUT firing anything — installing the integration must not
// replay months of old unread SMS into the scenes.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE_NAME = 'sms-seen.json';
const MAX_ENTRIES = 500;

export class SmsStore {
  /**
   * @param {string} directory where the file lives (`/data` in the image)
   */
  constructor(directory) {
    this.path = join(directory, FILE_NAME);
    this.directory = directory;
    this.initialized = false;
    this.seen = new Set();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      this.initialized = data.initialized === true;
      this.seen = new Set((data.seen ?? []).filter(Number.isInteger));
    } catch {
      // No file (first run) or an unreadable one: start over, baseline first.
      this.initialized = false;
      this.seen = new Set();
    }
  }

  async save() {
    const seen = [...this.seen].slice(-MAX_ENTRIES);
    const body = JSON.stringify({ initialized: this.initialized, seen });
    await mkdir(this.directory, { recursive: true });
    // Write then rename: a crash mid-write never leaves a half file.
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, body, 'utf8');
    await rename(temporary, this.path);
  }
}
