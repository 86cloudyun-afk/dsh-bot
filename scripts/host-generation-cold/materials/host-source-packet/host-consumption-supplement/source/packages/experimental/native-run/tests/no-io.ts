/** Offline acceptance fuse; fake fetch in tests is the sole external boundary. */
import { afterAll, expect } from 'vitest'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import childProcess from 'node:child_process'

const counts = { networkAttempts: 0, listenerAttempts: 0, childProcessAttempts: 0 }
const deny = (key: keyof typeof counts) => () => {
  counts[key]++
  throw new Error(`OFFLINE_${key}`)
}
const fuses: Array<{ object: object; name: string; replacement: () => never }> = []
const install = (object: object, name: string, key: keyof typeof counts) => {
  const replacement = deny(key)
  Object.defineProperty(object, name, { value: replacement, configurable: true, writable: true })
  fuses.push({ object, name, replacement })
}
install(net.Socket.prototype, 'connect', 'networkAttempts')
install(net.Server.prototype, 'listen', 'listenerAttempts')
install(http, 'request', 'networkAttempts')
install(https, 'request', 'networkAttempts')
install(dns, 'lookup', 'networkAttempts')
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
  install(childProcess, name, 'childProcessAttempts')
}
// Tests restore fake fetch stubs; Node socket fuses remain the last line of defense.
afterAll(() => {
  for (const fuse of fuses) expect(Reflect.get(fuse.object, fuse.name)).toBe(fuse.replacement)
  expect(counts).toEqual({ networkAttempts: 0, listenerAttempts: 0, childProcessAttempts: 0 })
  process.stdout.write(JSON.stringify({ offlineIO: counts }) + '\n')
})
