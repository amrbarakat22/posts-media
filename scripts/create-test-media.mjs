/* global Buffer, process */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const run = (command, args) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const errors = [];
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolveRun()
        : reject(
            new Error(
              `${command} failed: ${Buffer.concat(errors).toString('utf8')}`,
            ),
          ),
    );
  });

export async function createTestMedia(directory) {
  await mkdir(directory, { recursive: true });
  const image = join(directory, 'image.png');
  const audio = join(directory, 'audio.wav');
  const video = join(directory, 'video.mp4');
  await sharp({
    create: { width: 640, height: 360, channels: 4, background: '#2563eb' },
  })
    .png()
    .toFile(image);
  await run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    '-c:a',
    'pcm_s16le',
    audio,
  ]);
  await run('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=24:duration=1',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=660:duration=1',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    video,
  ]);
  await writeFile(join(directory, 'invalid.png'), 'not a png');
  await writeFile(
    join(directory, 'corrupt.mp4'),
    Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70]),
  );
  return { image, audio, video };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? 'tmp/test-media');
  await createTestMedia(directory);
  process.stdout.write(`${directory}\n`);
}
