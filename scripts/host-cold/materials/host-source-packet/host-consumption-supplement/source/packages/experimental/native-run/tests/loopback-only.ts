/** Legacy prepared transport fixtures use ephemeral IPv4 loopback only. */
import net from 'node:net'
import dns from 'node:dns'
import childProcess from 'node:child_process'
import { afterAll, expect } from 'vitest'

const counts = { loopbackConnections: 0, loopbackListeners: 0, externalAttempts: 0, childProcessAttempts: 0 }
const servers = new Set<net.Server>()
const originalConnect = net.Socket.prototype.connect
const originalListen = net.Server.prototype.listen
const originalLookup = dns.lookup
const originalFetch = globalThis.fetch
const deny = () => { counts.externalAttempts++; throw new Error('OFFLINE_EXTERNAL_IO') }
Object.defineProperty(net.Socket.prototype, 'connect', { configurable: true, value: function(this: net.Socket, ...args: unknown[]) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0]
  if (input === null || typeof input !== 'object' || !('host' in input) || input.host !== '127.0.0.1') deny()
  counts.loopbackConnections++
  return Reflect.apply(originalConnect, this, args)
} })
Object.defineProperty(net.Server.prototype, 'listen', { configurable: true, value: function(this: net.Server, ...args: unknown[]) {
  if (args[0] !== 0 || args[1] !== '127.0.0.1') deny()
  counts.loopbackListeners++; servers.add(this)
  return Reflect.apply(originalListen, this, args)
} })
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') deny()
  return originalFetch(input, init)
}
Object.defineProperty(dns, 'lookup', { configurable: true, value: (...args: unknown[]) => {
  if (args[0] !== '127.0.0.1') deny()
  return Reflect.apply(originalLookup, dns, args)
} })
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  Object.defineProperty(childProcess, name, { configurable: true, value: () => { counts.childProcessAttempts++; throw new Error('OFFLINE_CHILD_PROCESS') } })
}
afterAll(() => {
  expect(counts.externalAttempts).toBe(0); expect(counts.childProcessAttempts).toBe(0)
  for (const server of servers) expect(server.listening).toBe(false)
  process.stdout.write(JSON.stringify({ legacyLoopbackIO: counts, listenersClosed: true }) + '\n')
})
