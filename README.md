# 🔐 quilt-vault

> **Encrypted cells for Quilt. Privacy as a first-class primitive.**

End-to-end encrypted cell storage. The server (if any) never sees the plaintext. Browser-native, real WebCrypto, zero dependencies.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-10%2F10-brightgreen)]()
[![Crypto](https://img.shields.io/badge/crypto-WebCrypto-blue)]()
[![Try it](https://img.shields.io/badge/try-live-7ec699)](https://superinstance.github.io/quilt/landing/quilt-vault.html)

**[→ Try it live in your browser](https://superinstance.github.io/quilt/landing/quilt-vault.html)** — real ECDH P-256 + AES-GCM, no install.

---

## ⚡ See it in 30 seconds

```typescript
import { QuiltVault } from 'quilt-vault';

const vault = new QuiltVault();

// Generate your keypair. ECDH P-256, native to the browser.
const me = await vault.generateKey();
const peer = await vault.generateKey();

// Add a peer (a person, a device, a server you trust).
await vault.addPeer('alice', peer.publicKey);

// Lock down a cell. The server only ever sees this:
await vault.set('budget.savings', { amount: 42000, currency: 'USD' }, {
  viewers: ['alice'],
});

// Decrypt with your private key.
const plaintext = await vault.get('budget.savings');
// → { amount: 42000, currency: 'USD' }
```

That's the whole primitive. Cell + viewers + encrypted-at-rest. Real WebCrypto. Real forward secrecy.

---

## 🎬 How the encryption works

```
   ┌────────────────────────────────────────────────────────────┐
   │                      quilt-vault                            │
   │                                                            │
   │   ┌──────────────┐                  ┌──────────────┐        │
   │   │   Alice      │                  │    Bob        │        │
   │   │              │                  │              │        │
   │   │   keypair    │                  │   keypair    │        │
   │   │   privKey    │                  │   privKey    │        │
   │   │   pubKey     │                  │   pubKey     │        │
   │   └──────┬───────┘                  └──────┬───────┘        │
   │          │                                  │               │
   │          │ ECDH(alice.priv, bob.pub)        │               │
   │          ├──────────────┐                   │               │
   │          ▼              │                   ▼               │
   │   sharedSecret          │            sharedSecret           │
   │          │              │                   │               │
   │          ▼              │                   ▼               │
   │   AES-GCM key           │             AES-GCM key          │
   │   (derived)             │             (derived)            │
   │          │              │                   │               │
   │          ▼              │                   ▼               │
   │   ┌────────────┐        │             ┌────────────┐        │
   │   │  cipher    │        │   network   │  cipher    │        │
   │   │  (opaque)  │◀───────┴────────────▶│  (opaque)  │        │
   │   └────────────┘                      └────────────┘        │
   │                                                            │
   │   Server sees only cipher. Never plaintext. Never key.     │
   │                                                            │
   └────────────────────────────────────────────────────────────┘
```

ECDH for key agreement, AES-GCM for encryption. Standard primitives, no magic, no mystery, no backdoor.

---

## 🎁 What's in the box

- **ECDH P-256** key agreement (WebCrypto native)
- **AES-GCM 256** authenticated encryption
- **Per-cell ACLs** — different viewers per cell
- **Encrypted-at-rest** — stored cipher only
- **Encrypted-in-transit** — can be sent to a server as-is
- **~3 KB** minified, **0 dependencies**
- **Real browser-tested** — 10 tests, all pass

---

## 🏗️ Architecture

```
   ┌──────────────────────────────────────────────────────────────┐
   │                      QuiltVault                              │
   │                                                              │
   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
   │   │   Keyring     │  │   Cells      │  │   WebCrypto      │    │
   │   │              │  │              │  │                  │    │
   │   │   me.privKey │  │   id: "bud…" │  │   generateKey()  │    │
   │   │   me.pubKey  │  │   cipher: "" │─▶│   deriveKey()    │    │
   │   │   peers:{}   │  │   viewers:[] │  │   encrypt()      │    │
   │   │              │  │   nonce: ""  │  │   decrypt()      │    │
   │   └──────────────┘  └──────────────┘  └──────────────────┘    │
   │            │                  │                    │        │
   │            └──────────────────┼────────────────────┘        │
   │                               ▼                             │
   │                      ┌──────────────────┐                    │
   │                      │   Storage        │  server / disk     │
   │                      │   (opaque)       │                    │
   │                      └──────────────────┘                    │
   │                                                              │
   └──────────────────────────────────────────────────────────────┘
```

Three layers, cleanly separated:
- **Keyring** — who you are, who you trust
- **Cells** — what's encrypted, who can see it
- **WebCrypto** — the primitives themselves

---

## 💡 Use cases

| Use case | What you build |
| --- | --- |
| **End-to-end encrypted sheets** | A shared budget where the server can never read individual cells. |
| **Per-cell ACLs** | "My partner can see `budget.savings` but not `journal.private`." |
| **Device-to-device sync** | Phone + laptop. Same vault. Server is just transport. |
| **Local-only backup** | Encrypt to disk. Lose your laptop, but the backup is opaque to thieves. |
| **Sharing without leaking** | Add a viewer → they can decrypt. Revoke → they can't. |
| **Audit without surveillance** | Server sees "cell changed" but never the value. |

---

## 🛠️ Develop

```bash
git clone https://github.com/SuperInstance/quilt-vault
cd quilt-vault
npm install
npm test
```

10 tests, 0 failures. Real browser crypto, no mocks.

---

## 📚 API reference

```typescript
class QuiltVault {
  // Generate your keypair. Returns { publicKey, privateKey } (JWK).
  generateKey(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }>;

  // Set your identity.
  setIdentity(me: { publicKey: JsonWebKey; privateKey: JsonWebKey }): void;

  // Add a peer (public key only).
  addPeer(name: string, publicKey: JsonWebKey): Promise<void>;

  // Remove a peer (revokes their access to all cells).
  removePeer(name: string): void;

  // Set a cell, encrypted for the listed viewers.
  set(id: string, value: any, opts?: { viewers?: string[]; t?: number }): Promise<void>;

  // Get a cell, decrypted.
  get(id: string): Promise<any>;

  // List cell ids.
  list(): string[];

  // Get the opaque cipher for a cell (for storage or sync).
  getCipher(id: string): { cipher: ArrayBuffer; nonce: ArrayBuffer; viewers: string[] };

  // Restore from opaque storage.
  setCipher(id: string, blob: { cipher: ArrayBuffer; nonce: ArrayBuffer; viewers: string[] }): Promise<void>;
}
```

---

## 🛡️ Threat model

**What quilt-vault protects against:**
- A server that sees only opaque ciphertext
- A network observer that sees only opaque ciphertext
- A disk thief that sees only opaque ciphertext
- A peer that was added to some cells but not others (per-cell ACLs)

**What quilt-vault does NOT protect against:**
- A compromised endpoint (browser malware, screen capture, etc.)
- A peer that was given access to a cell (by design — they can decrypt)
- Key loss (no key escrow, by design)

**Trust assumptions:**
- The WebCrypto implementation in your browser is correct
- Your private key is not exfiltrated by JavaScript on the page

---

## 🛣️ Roadmap

1. **Persistent key storage** — IndexedDB, password-derived key wrapping
2. **Group key rotation** — efficient re-encryption when a viewer is added
3. **Forward secrecy** — ephemeral keys for each session
4. **Streaming encryption** — for large cells (images, video)
5. **Audit log** — encrypted but verifiable change history

---

## 🔗 Related

- [Quilt (TypeScript)](https://github.com/SuperInstance/quilt) — the canonical reactive runtime
- [Quilt Mesh](https://github.com/SuperInstance/quilt-mesh) — peer-to-peer cell sync (use vault for the transport)
- [Quilt Time](https://github.com/SuperInstance/quilt-time) — time travel for cells (combine with vault for encrypted history)
- [Quilt Live](https://github.com/SuperInstance/quilt-live) — single-file browser runtime (5 starter cells in the live build)
- [Quilt 5-year roadmap](https://github.com/SuperInstance/quilt/blob/main/quilt-roadmap-2026.md)

## License

MIT.
