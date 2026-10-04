import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import dgram from 'node:dgram';
import http2 from 'node:http2';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
test('test guard covers implicit subtests, network, child process and outside filesystem',async t=>{
 await t.test('network constructors cannot escape guard',()=>{
  for(const attempt of [()=>dgram.createSocket('udp4'),()=>http2.connect('https://example.invalid'),()=>new net.Socket().connect(443,'example.invalid'),()=>execFileSync(process.execPath,['--version']),()=>fetch('https://example.invalid')]) assert.throws(attempt,/DSH_BOT_TEST_SIDE_EFFECT_DENIED/);
 });
 await t.test('filesystem authority is restricted to repo and isolated temp',()=>{assert.throws(()=>readFileSync('/etc/hosts'),{code:'ERR_ACCESS_DENIED'});});
 await t.test('parent credential environment is not inherited',()=>{for(const k of Object.keys(process.env)) assert.ok(['DSH_HOME','DSH_BOT_TEST_ROOT','TMPDIR','TZ','LANG','NODE_TEST_CONTEXT'].includes(k),`unexpected inherited key ${k}`);});
});
