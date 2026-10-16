import { describe, expect, it } from 'bun:test';
import { isOk } from '@lexdistill/shared';
import { app, drizzleRepo } from '../../../index.js';

/**
 * P3-2 文档 GET opt-in segments 桥。
 * - 默认关闭：响应无 segments 键；
 * - 开启：段 id/lesson/ord＋文本截断（200）；
 * - 跨用户沿用 404；无段即空数组。
 */
describe('document GET includeSegments bridge (P3-2)', () => {
  async function seedDoc(id: string, userId: string, content: string): Promise<void> {
    const saved = await drizzleRepo.saveDocument({
      id,
      userId,
      title: 'T',
      sourceKind: 'user_import',
      language: 'ja',
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(isOk(saved)).toBe(true);
  }

  it('默认关闭：无 segments 键', async () => {
    await seedDoc('bridge-off', 'u1', '第一段\n\n第二段');
    const res = await app.request('/api/documents/u1/bridge-off');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect('segments' in body).toBe(false);
  });

  it('开启：段地址＋文本截断', async () => {
    await seedDoc('bridge-on', 'u1', `甲段\n\n${'乙'.repeat(300)}`);
    const projected = await drizzleRepo.reprojectDocumentSegments('u1', 'bridge-on');
    expect(isOk(projected)).toBe(true);
    const res = await app.request('/api/documents/u1/bridge-on?includeSegments=true');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      segments: Array<{ lessonId: string; ord: number; text: string; truncated: boolean }>;
    };
    expect(body.segments.length).toBe(2);
    expect(body.segments[0]).toMatchObject({ lessonId: '', ord: 0, truncated: false });
    expect(body.segments[1]!.text.length).toBe(200);
    expect(body.segments[1]!.truncated).toBe(true);
  });

  it('跨用户：沿用 404（不泄露存在性）', async () => {
    await seedDoc('bridge-private', 'uA', '甲段');
    const res = await app.request('/api/documents/uB/bridge-private?includeSegments=true');
    expect(res.status).toBe(404);
  });

  it('无段：空数组', async () => {
    await seedDoc('bridge-empty', 'u1', '孤段');
    const res = await app.request('/api/documents/u1/bridge-empty?includeSegments=true');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { segments: unknown[] };
    expect(body.segments).toEqual([]);
  });
});
