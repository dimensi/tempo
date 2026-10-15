import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { runProcessGroup } from '../../scripts/ci/process-group.mjs';

for (const mode of [
  'exit',
  'immediate exit',
  'failure',
  'cancel',
  'fork during TERM',
]) {
  test(`owned detached descendants are stopped after ${mode}`, async () => {
    const directory = mkdtempSync(`${tmpdir()}/yazio-cleanup-test-`);
    const controller = new AbortController();
    const script = `
      const {spawn}=require('node:child_process');
      const {writeFileSync}=require('node:fs');
      const child=spawn(process.execPath,['-e',${JSON.stringify(mode === 'fork during TERM' ? "process.on('SIGTERM',()=>{const grandchild=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});grandchild.unref();require('node:fs').writeFileSync('grandchild',String(grandchild.pid));process.exit(0)});setInterval(()=>{},1000)" : 'setInterval(()=>{},1000)')}],{detached:true,stdio:'ignore'});
      child.unref();writeFileSync('pid',String(child.pid));
      ${mode === 'cancel' || mode === 'fork during TERM' ? 'setInterval(()=>{},1000);' : `setTimeout(()=>process.exit(${mode === 'failure' ? 1 : 0}),${mode === 'immediate exit' ? 0 : 750});`}
    `;
    const timer = ['cancel', 'fork during TERM'].includes(mode)
      ? setTimeout(() => controller.abort(), 750)
      : undefined;
    try {
      const running = runProcessGroup(process.execPath, ['-e', script], {
        cwd: directory,
        env: process.env,
        signal: controller.signal,
      });
      if (['cancel', 'fork during TERM'].includes(mode))
        await assert.rejects(running, /cancelled/);
      else assert.equal(await running, mode === 'failure' ? 1 : 0);
      const pids = [Number(readFileSync(`${directory}/pid`, 'utf8'))];
      if (mode === 'fork during TERM')
        pids.push(Number(readFileSync(`${directory}/grandchild`, 'utf8')));
      for (const pid of pids) {
        // An exited zombie cannot execute or keep storage/network handles open.
        let state;
        try {
          state =
            process.platform === 'darwin'
              ? spawnSync('ps', ['-p', String(pid), '-o', 'stat='], {
                  encoding: 'utf8',
                }).stdout.trim()[0]
              : readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0];
        } catch (error) {
          assert.equal(error.code, 'ENOENT');
        }
        assert.ok(
          state === undefined || state === 'Z',
          `left running descendant ${pid}: ${state}`,
        );
      }
      await delay(20);
    } finally {
      clearTimeout(timer);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
