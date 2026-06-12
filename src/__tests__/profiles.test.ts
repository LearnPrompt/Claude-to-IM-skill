import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseBridgesConfig, getProfile } from '../profiles.js';

const VALID = JSON.stringify({
  bridges: [
    {
      id: 'codex',
      runtime: 'codex',
      home: '/Users/demo/.claude-to-im',
      launchdLabel: 'com.claude-to-im.bridge',
      channels: ['feishu'],
    },
    {
      id: 'claude',
      runtime: 'claude',
      home: '/Users/demo/.claude-to-im-claude',
      launchdLabel: 'com.claude-to-im.bridge.claude',
      channels: ['feishu'],
    },
  ],
});

describe('parseBridgesConfig', () => {
  it('parses a valid two-profile config', () => {
    const cfg = parseBridgesConfig(VALID, 'test');
    assert.equal(cfg.bridges.length, 2);
    assert.equal(cfg.bridges[0].id, 'codex');
    assert.equal(cfg.bridges[1].runtime, 'claude');
  });

  it('rejects invalid JSON', () => {
    assert.throws(() => parseBridgesConfig('{nope', 'test'), /not valid JSON/);
  });

  it('rejects missing bridges array', () => {
    assert.throws(() => parseBridgesConfig('{}', 'test'), /"bridges" array/);
  });

  it('rejects empty bridges array', () => {
    assert.throws(() => parseBridgesConfig('{"bridges":[]}', 'test'), /empty/);
  });

  it('rejects duplicate ids', () => {
    const dup = JSON.parse(VALID);
    dup.bridges[1].id = 'codex';
    dup.bridges[1].home = '/Users/demo/other';
    dup.bridges[1].launchdLabel = 'com.other';
    assert.throws(() => parseBridgesConfig(JSON.stringify(dup), 'test'), /duplicate profile id/);
  });

  it('rejects invalid runtime', () => {
    const bad = JSON.parse(VALID);
    bad.bridges[0].runtime = 'gemini';
    assert.throws(() => parseBridgesConfig(JSON.stringify(bad), 'test'), /runtime/);
  });

  it('rejects relative home', () => {
    const bad = JSON.parse(VALID);
    bad.bridges[0].home = 'relative/path';
    assert.throws(() => parseBridgesConfig(JSON.stringify(bad), 'test'), /absolute path/);
  });

  it('rejects shared home between profiles', () => {
    const bad = JSON.parse(VALID);
    bad.bridges[1].home = bad.bridges[0].home;
    assert.throws(() => parseBridgesConfig(JSON.stringify(bad), 'test'), /duplicate profile home/);
  });

  it('rejects bad launchd label characters', () => {
    const bad = JSON.parse(VALID);
    bad.bridges[0].launchdLabel = 'com bridge with spaces';
    assert.throws(() => parseBridgesConfig(JSON.stringify(bad), 'test'), /launchdLabel/);
  });

  it('rejects duplicate launchd labels', () => {
    const bad = JSON.parse(VALID);
    bad.bridges[1].launchdLabel = bad.bridges[0].launchdLabel;
    assert.throws(() => parseBridgesConfig(JSON.stringify(bad), 'test'), /duplicate launchdLabel/);
  });

  it('rejects empty channels', () => {
    const bad = JSON.parse(VALID);
    bad.bridges[0].channels = [];
    assert.throws(() => parseBridgesConfig(JSON.stringify(bad), 'test'), /channels/);
  });
});

describe('getProfile', () => {
  it('finds a profile by id and errors on unknown id', () => {
    const cfg = parseBridgesConfig(VALID, 'test');
    assert.equal(getProfile(cfg, 'claude').runtime, 'claude');
    assert.throws(() => getProfile(cfg, 'nope'), /unknown profile "nope" \(known: codex, claude\)/);
  });
});
