import { describe, expect, it } from 'bun:test';
import {
  audioChunksToBlob,
  base64ToBytes,
  isRawPcmMime,
  parsePcmRate,
  pcmChunksToWavBlob,
} from '../pcm-audio.js';

describe('pcm-audio base64', () => {
  it('round-trips bytes through base64', () => {
    const raw = new Uint8Array([0, 1, 2, 250, 255]);
    const encoded = Buffer.from(raw).toString('base64');
    expect(base64ToBytes(encoded)).toEqual(raw);
  });

  it('accepts data URLs and rejects invalid input', () => {
    const raw = new Uint8Array([10, 20, 30]);
    const url = `data:audio/wav;base64,${Buffer.from(raw).toString('base64')}`;
    expect(base64ToBytes(url)).toEqual(raw);
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
    expect(() => base64ToBytes('!!!not-base64!!!')).toThrow();
  });
});

describe('pcm-audio mime helpers', () => {
  it('parses sample rate with gateway default fallback', () => {
    expect(parsePcmRate('audio/L16;codec=pcm;rate=24000')).toBe(24000);
    expect(parsePcmRate('audio/L16;rate=16000')).toBe(16000);
    expect(parsePcmRate('audio/wav')).toBe(24000);
    expect(parsePcmRate(null)).toBe(24000);
  });

  it('distinguishes raw PCM from complete files', () => {
    expect(isRawPcmMime('audio/L16;codec=pcm;rate=24000')).toBe(true);
    expect(isRawPcmMime('audio/pcm')).toBe(true);
    expect(isRawPcmMime('audio/wav')).toBe(false);
    expect(isRawPcmMime('audio/mpeg')).toBe(false);
  });
});

describe('pcm-audio blob assembly', () => {
  it('wraps PCM chunks in a valid WAV header', async () => {
    const chunks = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6])];
    const blob = pcmChunksToWavBlob(chunks, 24000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 6);
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    expect(String.fromCharCode(...header.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...header.slice(8, 12))).toBe('WAVE');
  });

  it('concatenates complete files without re-wrapping', async () => {
    const chunks = [new Uint8Array([7, 8]), new Uint8Array([9])];
    const blob = audioChunksToBlob(chunks, 'audio/mpeg', 24000);
    expect(blob.type).toBe('audio/mpeg');
    expect(blob.size).toBe(3);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('routes PCM mimes through the WAV wrapper', () => {
    const blob = audioChunksToBlob([new Uint8Array([1, 2])], 'audio/L16;codec=pcm;rate=24000', 24000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 2);
  });

  it('rejects empty chunk lists', () => {
    expect(() => audioChunksToBlob([], 'audio/wav', 24000)).toThrow();
  });
});
