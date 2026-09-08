/* OPFS-backed workspace storage (mirrors the reference browser-POC pattern).
 * The workspace is a single SQLite database file plus a small sidecar JSON
 * metadata file, both stored under the Origin Private File System.
 */
export class WorkspaceStorage {
  constructor(name = 'robot-motion-designer') {
    this.name = name;
    this.metadata = { revision: 0 };
  }

  async open() {
    const root = await navigator.storage.getDirectory();
    this.directory = await root.getDirectoryHandle(this.name, { create: true });
    this.file = await this.directory.getFileHandle('workspace.db', { create: true });
    try {
      const sidecar = await this.directory.getFileHandle('workspace.json');
      this.metadata = { ...this.metadata, ...JSON.parse(await (await sidecar.getFile()).text()) };
    } catch (_) {}
    const bytes = new Uint8Array(await (await this.file.getFile()).arrayBuffer());
    this.workspaceBytes = bytes.byteLength;
    return bytes;
  }

  async replace(bytes) {
    const writable = await this.file.createWritable();
    try {
      await writable.write(bytes);
      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch (_) {}
      throw error;
    }
    this.workspaceBytes = bytes.byteLength;
    this.metadata = {
      ...this.metadata,
      revision: (this.metadata.revision || 0) + 1,
      lastPersisted: new Date().toISOString(),
    };
    try {
      const sidecar = await this.directory.getFileHandle('workspace.json', { create: true });
      const w = await sidecar.createWritable();
      await w.write(JSON.stringify(this.metadata));
      await w.close();
    } catch (_) {}
  }

  async export() {
    return (await this.file.getFile()).arrayBuffer();
  }
}