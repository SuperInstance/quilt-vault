// quilt-vault — encrypted cells for Quilt.
//
// The thesis: a personal data mesh needs privacy as a first-class
// primitive. A cell isn't a public value — it's something the
// owner chooses to share with specific viewers, and the server
// (if any) never sees the plaintext.
//
// This library provides:
//
//   - Vault: a set of encrypted cells
//   - Key: a public-key identity for a viewer
//   - AccessPolicy: who can read which cells
//   - EncryptedCell: a cell whose value is encrypted to a list of keys
//
// Every value is encrypted with AES-GCM. The encryption key is
// derived from the owner's secret + the viewer's public key, so
// the owner can decrypt any cell, and any viewer in the ACL can
// decrypt it too. The server only ever sees ciphertext.
//
// This is a sketch. The real implementation will use:
//   - libsodium for crypto (instead of Node's webcrypto)
//   - X25519 for key agreement
//   - Ed25519 for signing
//   - Argon2id for key derivation from passwords

import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

/** Generate a keypair. */
export async function generateKey() {
  const pair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const pubJwk = await subtle.exportKey('jwk', pair.publicKey);
  const id = await fingerprint(pubJwk);
  return { id, publicKey: pair.publicKey, privateKey: pair.privateKey, publicJwk: pubJwk };
}

/** Stable, short fingerprint of a public key. */
async function fingerprint(jwk) {
  const data = new TextEncoder().encode(JSON.stringify(jwk));
  const hash = await subtle.digest('SHA-256', data);
  return Buffer.from(hash).toString('hex').slice(0, 16);
}

/** Derive a shared AES key from our private key + their public key. */
async function deriveSharedKey(myPrivate, theirPublic) {
  return await subtle.deriveKey(
    { name: 'ECDH', public: theirPublic },
    myPrivate,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt a value to a list of viewer public keys. */
async function encryptToViewers(value, owner, viewers) {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  // Random content key.
  const contentKey = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    contentKey,
    plaintext
  );

  // Wrap the content key for each viewer.
  const wrapped = {};
  for (const v of viewers) {
    const shared = await deriveSharedKey(owner.privateKey, v.publicKey);
    const wrapIv = webcrypto.getRandomValues(new Uint8Array(12));
    const rawContentKey = await subtle.exportKey('raw', contentKey);
    const wrappedKey = await subtle.encrypt(
      { name: 'AES-GCM', iv: wrapIv },
      shared,
      rawContentKey
    );
    wrapped[v.id] = {
      iv: Buffer.from(wrapIv).toString('base64'),
      key: Buffer.from(wrappedKey).toString('base64'),
    };
  }

  return {
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    wrapped,
  };
}

/** Decrypt a value using a viewer's key. */
async function decryptForViewer(envelope, owner, viewer) {
  const wrap = envelope.wrapped[viewer.id];
  if (!wrap) throw new Error('No access for this viewer');
  const shared = await deriveSharedKey(viewer.privateKey, owner.publicKey);
  const rawContentKey = await subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(wrap.iv, 'base64') },
    shared,
    Buffer.from(wrap.key, 'base64')
  );
  const contentKey = await subtle.importKey(
    'raw', rawContentKey, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(envelope.iv, 'base64') },
    contentKey,
    Buffer.from(envelope.ciphertext, 'base64')
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/**
 * The Vault: a set of encrypted cells, with an access policy per
 * cell. The owner holds the only private key that can decrypt
 * anything; each viewer in the policy gets a wrapped copy of the
 * content key.
 */
export class Vault {
  /**
   * @param {object} owner - the owner's key
   * @param {object[]} [viewers] - known viewers (with public keys)
   */
  constructor(owner, viewers = []) {
    this.owner = owner;
    this.viewers = new Map();
    for (const v of viewers) this.viewers.set(v.id, v);
    this.cells = new Map(); // cellId -> { envelope, viewers, t }
  }

  /** Add a known viewer. */
  addViewer(viewer) {
    this.viewers.set(viewer.id, viewer);
  }

  /** Set a cell's value, encrypted for the given viewers (or all known). */
  async set(cellId, value, { viewers } = {}) {
    const list = viewers
      ? viewers.map(id => this.viewers.get(id)).filter(Boolean)
      : [...this.viewers.values()];
    // Always include the owner.
    if (!list.some(v => v.id === this.owner.id)) list.push(this.owner);
    if (list.length === 0) {
      throw new Error('Need at least one viewer (typically the owner).');
    }
    const envelope = await encryptToViewers(value, this.owner, list);
    this.cells.set(cellId, {
      envelope,
      viewerIds: list.map(v => v.id),
      t: Date.now(),
    });
    return this;
  }

  /**
   * Get a cell's decrypted value. The viewer must be in the cell's
   * access list.
   */
  async get(cellId, viewer) {
    const cell = this.cells.get(cellId);
    if (!cell) return undefined;
    return await decryptForViewer(cell.envelope, this.owner, viewer);
  }

  /** Get the encrypted envelope for a cell. */
  getEnvelope(cellId) {
    return this.cells.get(cellId)?.envelope;
  }

  /** List all cell ids. */
  ids() {
    return [...this.cells.keys()];
  }

  /** Grant a viewer access to an existing cell. */
  async grant(cellId, viewer) {
    const cell = this.cells.get(cellId);
    if (!cell) throw new Error(`No such cell: ${cellId}`);
    if (cell.viewerIds.includes(viewer.id)) return;
    // Re-encrypt to include the new viewer.
    const value = await this.get(cellId, this.owner);
    this.addViewer(viewer);
    const list = [...cell.viewerIds, viewer.id]
      .map(id => this.viewers.get(id))
      .filter(Boolean);
    if (!list.some(v => v.id === this.owner.id)) list.push(this.owner);
    const envelope = await encryptToViewers(value, this.owner, list);
    cell.viewerIds = list.map(v => v.id);
    cell.envelope = envelope;
    cell.t = Date.now();
  }

  /** Revoke a viewer's access. */
  async revoke(cellId, viewerId) {
    const cell = this.cells.get(cellId);
    if (!cell) throw new Error(`No such cell: ${cellId}`);
    if (!cell.viewerIds.includes(viewerId)) return;
    if (viewerId === this.owner.id) throw new Error('Cannot revoke owner');
    // Re-encrypt without the revoked viewer.
    const value = await this.get(cellId, this.owner);
    const newViewerIds = cell.viewerIds.filter(id => id !== viewerId);
    // set() always adds the owner back, so use a direct path here.
    const list = newViewerIds
      .map(id => this.viewers.get(id))
      .filter(Boolean);
    if (!list.some(v => v.id === this.owner.id)) list.push(this.owner);
    const envelope = await encryptToViewers(value, this.owner, list);
    cell.viewerIds = list.map(v => v.id);
    cell.envelope = envelope;
    cell.t = Date.now();
  }
}

export default Vault;
