# quilt-vault

> Encrypted cells for Quilt. Privacy as a first-class primitive.

A standalone library. End-to-end encrypted cell storage. The server (if any) never sees the plaintext.

## The thesis

A personal data mesh needs privacy as a first-class primitive. If the server can read your budget, the server knows your budget. If the server can read your location, the server knows your location. If the server can read your medical data, the server knows your medical data. **That's the bug.** A personal data mesh must not work that way.

A Quilt cell isn't a public value. It's something the owner chooses to share with specific viewers. The server only ever sees ciphertext. The owner holds the master key. Each viewer in the access list gets a wrapped copy of the content key.

The model is end-to-end encryption with per-cell access control. Think of it as "Apple's encryption for a personal data cloud, but the keys are yours, not Apple's."

## Install

```bash
npm install quilt-vault
```

## Use

```js
import { Vault, generateKey } from 'quilt-vault';

// Owner and viewers each have a keypair.
const alice = await generateKey();
const bob = await generateKey();
const carol = await generateKey();

// Alice owns a vault; she knows about bob and carol.
const vault = new Vault(alice, [bob, carol]);

// Set a cell, encrypted for the named viewers (or all known).
await vault.set('budget.netWorth', 50_000);
await vault.set('budget.account.bank', 5_000, { viewers: [bob.id] });
await vault.set('health.weight', 165, { viewers: [carol.id] });

// Read it back. Only the viewers in the access list can decrypt.
(await vault.get('budget.netWorth', alice));     // → 50000
(await vault.get('budget.account.bank', bob));   // → 5000
(await vault.get('health.weight', carol));       // → 165

// A non-viewer cannot decrypt.
try {
  await vault.get('health.weight', bob);
} catch (e) {
  console.log('Bob has no access to health.weight');  // ← this fires
}

// Grant access after the fact.
await vault.grant('budget.netWorth', bob);
(await vault.get('budget.netWorth', bob));   // → 50000

// Revoke access.
await vault.revoke('budget.netWorth', bob.id);
try {
  await vault.get('budget.netWorth', bob);
} catch (e) {
  console.log('Bob can no longer read');  // ← this fires
}
```

## How it works

Each cell has:

1. **A content key** — a random AES-256 key, generated per cell.
2. **A ciphertext** — the value, encrypted with the content key using AES-GCM.
3. **A list of wrapped keys** — the content key encrypted once for each viewer in the access list, using ECDH-derived keys (Curve25519 / P-256).

The owner has the master keypair. When they set a cell, they generate a content key, encrypt the value, then wrap the content key for each viewer using ECDH key agreement (`sharedSecret = ECDH(myPrivate, theirPublic)`).

The server only ever sees the ciphertext + wrapped keys. It cannot decrypt anything because it doesn't have any private keys.

When a viewer wants to read a cell, they unwrap the content key using `sharedSecret = ECDH(myPrivate, ownerPublic)`, then decrypt the value.

## Properties

- **End-to-end encryption.** Server cannot read anything.
- **Per-cell access control.** Each cell has its own viewer list.
- **Forward secrecy.** Revoking a viewer re-encrypts the cell with a new content key, so the revoked viewer can never read future versions.
- **Compact envelopes.** A cell is ~150 bytes (ciphertext) + ~200 bytes per viewer (wrapped key).
- **Key fingerprints.** Each key has a 16-hex-character ID derived from the public key.

## Test

```bash
npm test
```

10 tests pass. Cover: encryption round-trips, access control, grant, revoke, envelope opacity.

## Status

Design sketch. The crypto is real (ECDH P-256, AES-GCM, SHA-256), but the API is incomplete. The real implementation will:

1. **Use libsodium** instead of webcrypto. Better algorithms, better
   defaults, smaller attack surface.
2. **X25519 / Ed25519** instead of P-256. Faster, simpler, more
   battle-tested.
3. **Argon2id** for key derivation from passwords.
4. **Persistence** — store envelopes in IndexedDB, on disk, or in a
   server's blob store.
5. **Quota** — prevent cell values from getting too large.
6. **Signing** — sign every set operation so the cell graph is
   tamper-evident.
7. **Forward-secret ratchets** — like Signal, so a compromised
   long-term key doesn't expose past cells.

## Use cases

- **Personal data in the cloud.** Sync your cells across devices
  through a server that can't read them.
- **Selective sharing.** Share your budget with your partner, your
  health with your doctor, your calendar with your team — each
  on its own access list.
- **Time-traveling backups.** Combined with `quilt-time`, the
  history is also encrypted.
- **Mesh-compatible.** The envelopes are the same shape regardless
  of transport: HTTPS, WebSocket, BLE, LoRa, paper QR codes.
- **A personal server.** Run the vault on a Raspberry Pi at home.
  Your phone syncs to it. The server at the cloud provider never
  sees the plaintext.

## Why this matters

The current generation of personal-data tools (Notion, Apple Notes,
Google Docs) all work the same way: **the server sees your data.**
This is the bug. A personal data mesh flips it: **you see your data,
and only the people you choose to share with see it.**

This unlocks new applications:

- **Real personal finance.** Track your net worth without trusting
  a SaaS.
- **Real personal health.** Track your weight, blood pressure, sleep
  — without giving it to a tech company.
- **Real personal calendar.** Share with your partner selectively
  (just the date, not the event details).
- **Real personal communication.** End-to-end encrypted at the cell
  level, not just the message level.
- **A real personal cloud.** Sync your files, photos, music across
  devices without trusting a server.

## Related

- [Quilt (TypeScript)](https://github.com/SuperInstance/quilt) — the
  reactive runtime.
- [Quilt (Rust)](https://github.com/SuperInstance/quilt-rust) — the
  desktop runtime.
- [Quilt Live](https://github.com/SuperInstance/quilt-live) — the
  single-file browser runtime.
- [Quilt Time](https://github.com/SuperInstance/quilt-time) —
  time-travel for cells.
- [Quilt Mesh](https://github.com/SuperInstance/quilt-mesh) —
  peer-to-peer cell sync.
- [Quilt 5-year roadmap](https://github.com/SuperInstance/quilt/blob/main/quilt-roadmap-2026.md).

## License

MIT.
