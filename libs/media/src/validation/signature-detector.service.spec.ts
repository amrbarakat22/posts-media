import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectHeaderSignature,
  SignatureDetectorService,
} from './signature-detector.service';

const riff = (kind: string): Buffer =>
  Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from(kind)]);

describe('SignatureDetectorService', () => {
  it.each([
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
    [
      'png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/png',
    ],
    ['webp', riff('WEBP'), 'image/webp'],
    ['wav', riff('WAVE'), 'audio/wav'],
    ['mp3', Buffer.from('ID3\u0004\u0000\u0000'), 'audio/mpeg'],
    ['mp3', Buffer.from([0xff, 0xfb, 0x90, 0x64]), 'audio/mpeg'],
    ['aac', Buffer.from([0xff, 0xf1, 0x50, 0x80]), 'audio/aac'],
    ['flac', Buffer.from('fLaC'), 'audio/flac'],
    ['ogg', Buffer.from('OggS'), 'audio/ogg'],
    [
      'iso-bmff',
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom')]),
      'application/mp4',
    ],
    [
      'ebml',
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86]),
      'application/x-ebml',
    ],
  ])('detects the %s signature family', (format, bytes, mimeType) => {
    expect(detectHeaderSignature(bytes)).toMatchObject({
      format,
      mimeType,
    });
  });

  it.each([
    ['M4A ', 'm4a'],
    ['qt  ', 'mov'],
  ])('refines ISO BMFF major brand %j as %s', (brand, variant) => {
    const bytes = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftyp'),
      Buffer.from(brand),
      Buffer.alloc(4),
      Buffer.from(brand),
      Buffer.from('isom'),
    ]);
    expect(detectHeaderSignature(bytes)).toMatchObject({
      containerFamily: 'iso-bmff',
      containerVariant: variant,
    });
  });

  it('leaves shared ISO BMFF brands for FFprobe stream refinement', () => {
    const bytes = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypisom'),
      Buffer.alloc(4),
      Buffer.from('isommp42'),
    ]);
    expect(detectHeaderSignature(bytes)).toEqual({
      format: 'iso-bmff',
      mimeType: 'application/mp4',
      containerFamily: 'iso-bmff',
      containerEvidence: 'shared-iso',
    });
  });

  it.each([
    ['webm', 'webm'],
    ['matroska', 'mkv'],
  ])('refines EBML DocType %s as %s', (docType, variant) => {
    const docTypeBytes = Buffer.from(docType);
    const payload = Buffer.concat([
      Buffer.from([0x42, 0x82, 0x80 | docTypeBytes.length]),
      docTypeBytes,
    ]);
    const bytes = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | payload.length]),
      payload,
    ]);
    expect(detectHeaderSignature(bytes)).toMatchObject({
      containerFamily: 'ebml',
      containerVariant: variant,
    });
  });

  it('parses EBML elements and ignores a misleading string before a DocType beyond byte 64', () => {
    const misleadingVoid = Buffer.concat([
      Buffer.from([0xec, 0xc6]),
      Buffer.from('webm'),
      Buffer.alloc(66),
    ]);
    const docType = Buffer.concat([
      Buffer.from([0x42, 0x82, 0x88]),
      Buffer.from('matroska'),
    ]);
    const payload = Buffer.concat([misleadingVoid, docType]);
    const header = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | payload.length]),
      payload,
    ]);

    expect(detectHeaderSignature(header)).toMatchObject({
      containerFamily: 'ebml',
      containerVariant: 'mkv',
    });
  });

  it.each([
    Buffer.from([0xff, 0xe8, 0x90, 0x64]),
    Buffer.from([0xff, 0xfb, 0x00, 0x64]),
    Buffer.from([0xff, 0xfb, 0xfc, 0x64]),
  ])('does not accept an invalid MPEG frame sync', (bytes) => {
    expect(() => detectHeaderSignature(bytes)).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_FILE_SIGNATURE' }),
    );
  });

  describe('bounded file reading', () => {
    let directory: string;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'media-signature-'));
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    it('detects a signature from a file without loading the body', async () => {
      const path = join(directory, 'large.bin');
      await writeFile(
        path,
        Buffer.concat([
          Buffer.from([0xff, 0xd8, 0xff]),
          Buffer.alloc(1024 * 1024),
        ]),
      );

      await expect(
        new SignatureDetectorService().detect(path),
      ).resolves.toMatchObject({ format: 'jpeg' });
    });

    it('reads a bounded extended header to locate a structured EBML DocType beyond byte 64', async () => {
      const path = join(directory, 'extended-ebml.bin');
      const misleadingVoid = Buffer.concat([
        Buffer.from([0xec, 0xc6]),
        Buffer.from('webm'),
        Buffer.alloc(66),
      ]);
      const docType = Buffer.concat([
        Buffer.from([0x42, 0x82, 0x88]),
        Buffer.from('matroska'),
      ]);
      const payload = Buffer.concat([misleadingVoid, docType]);
      await writeFile(
        path,
        Buffer.concat([
          Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | payload.length]),
          payload,
          Buffer.alloc(1024 * 1024),
        ]),
      );

      await expect(
        new SignatureDetectorService().detect(path),
      ).resolves.toMatchObject({
        containerFamily: 'ebml',
        containerVariant: 'mkv',
      });
    });

    it('rejects an empty file with the stable code', async () => {
      const path = join(directory, 'empty.bin');
      await writeFile(path, Buffer.alloc(0));

      await expect(
        new SignatureDetectorService().detect(path),
      ).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    });
  });
});
