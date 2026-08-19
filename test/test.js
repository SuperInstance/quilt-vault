// Tests for quilt-vault.
import { Vault, generateKey } from '../src/index.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    console.log(e.stack);
    failed++;
  }
}

function assertEq(a, b, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

async function assertThrows(fn, msg) {
  let threw = false;
  try { await fn(); } catch { threw = true; }
  if (!threw) throw new Error(`Expected to throw: ${msg}`);
}

console.log('Encryption basics');

await test('owner can decrypt own cell', async () => {
  const owner = await generateKey();
  const vault = new Vault(owner);
  await vault.set('budget.total', 5000);
  const v = await vault.get('budget.total', owner);
  assertEq(v, 5000);
});

await test('different value types round-trip', async () => {
  const owner = await generateKey();
  const vault = new Vault(owner);
  await vault.set('a', 42);
  await vault.set('b', 'hello world');
  await vault.set('c', { nested: { deep: [1, 2, 3] } });
  await vault.set('d', [1, 'two', { three: 3 }]);
  assertEq(await vault.get('a', owner), 42);
  assertEq(await vault.get('b', owner), 'hello world');
  assertEq(await vault.get('c', owner), { nested: { deep: [1, 2, 3] } });
  assertEq(await vault.get('d', owner), [1, 'two', { three: 3 }]);
});

console.log('\nAccess control');

await test('granted viewer can read', async () => {
  const alice = await generateKey();
  const bob = await generateKey();
  const vault = new Vault(alice, [bob]);
  await vault.set('secret', 'alice and bob can see this');
  const a = await vault.get('secret', alice);
  const b = await vault.get('secret', bob);
  assertEq(a, 'alice and bob can see this');
  assertEq(b, 'alice and bob can see this');
});

await test('non-granted viewer cannot read', async () => {
  const alice = await generateKey();
  const bob = await generateKey();
  const eve = await generateKey();
  const vault = new Vault(alice, [bob]);
  await vault.set('secret', 'only alice and bob');
  // Eve is not in the access list.
  await assertThrows(() => vault.get('secret', eve), 'eve should not be able to read');
});

await test('restrict viewers per cell', async () => {
  const alice = await generateKey();
  const bob = await generateKey();
  const carol = await generateKey();
  const vault = new Vault(alice, [bob, carol]);
  // Public-to-bob-and-alice cell.
  await vault.set('public', 'bob can see this', { viewers: [bob.id] });
  // Private-to-carol cell.
  await vault.set('private', 'only carol can see this', { viewers: [carol.id] });
  assertEq(await vault.get('public', bob), 'bob can see this');
  await assertThrows(() => vault.get('public', carol), 'carol cannot read public');
  assertEq(await vault.get('private', carol), 'only carol can see this');
  await assertThrows(() => vault.get('private', bob), 'bob cannot read private');
});

console.log('\nGrant and revoke');

await test('grant adds a viewer to an existing cell', async () => {
  const alice = await generateKey();
  const bob = await generateKey();
  const carol = await generateKey();
  const vault = new Vault(alice);
  await vault.set('shared', 'initially just alice', { viewers: [] });
  // Carol starts out with no access.
  await assertThrows(() => vault.get('shared', carol), 'carol cannot read yet');
  // Grant carol access.
  await vault.grant('shared', carol);
  assertEq(await vault.get('shared', carol), 'initially just alice');
  // Alice can still read.
  assertEq(await vault.get('shared', alice), 'initially just alice');
});

await test('revoke removes a viewer', async () => {
  const alice = await generateKey();
  const bob = await generateKey();
  const vault = new Vault(alice, [bob]);
  await vault.set('secret', 'alice and bob');
  assertEq(await vault.get('secret', bob), 'alice and bob');
  await vault.revoke('secret', bob.id);
  await assertThrows(() => vault.get('secret', bob), 'bob can no longer read');
});

console.log('\nServer view');

await test('envelope is opaque without keys', async () => {
  const alice = await generateKey();
  const bob = await generateKey();
  const vault = new Vault(alice, [bob]);
  await vault.set('budget.total', 9999);
  const env = vault.getEnvelope('budget.total');
  // The envelope should not contain the plaintext.
  const asStr = JSON.stringify(env);
  if (asStr.includes('9999')) throw new Error('Plaintext leaked into envelope');
  if (asStr.includes('budget')) throw new Error('Plaintext leaked into envelope');
  // The envelope should contain ciphertext (base64) and wrapped keys.
  if (!env.ciphertext) throw new Error('Missing ciphertext');
  if (!env.wrapped) throw new Error('Missing wrapped keys');
  if (!env.wrapped[alice.id]) throw new Error('No wrapped key for alice');
  if (!env.wrapped[bob.id]) throw new Error('No wrapped key for bob');
});

console.log('\nIdempotence');

await test('set twice keeps the latest value', async () => {
  const owner = await generateKey();
  const vault = new Vault(owner);
  await vault.set('x', 1);
  await vault.set('x', 2);
  await vault.set('x', 3);
  assertEq(await vault.get('x', owner), 3);
});

await test('overwriting a cell changes the ciphertext', async () => {
  const owner = await generateKey();
  const vault = new Vault(owner);
  await vault.set('x', 'first');
  const env1 = vault.getEnvelope('x');
  await vault.set('x', 'second');
  const env2 = vault.getEnvelope('x');
  if (env1.ciphertext === env2.ciphertext) {
    throw new Error('Ciphertext did not change after update');
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
