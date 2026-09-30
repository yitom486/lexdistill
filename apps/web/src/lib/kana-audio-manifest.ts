/**
 * 假名内置音频清单（批量 TTS 预生成，随安装包发布）。
 *
 * 由 `scripts/ops/seed-kana-audio.ts` 生成并提交；key 为假名种子 id
 *（如 `kana_a`），value 为 `public/audio/kana/` 下的文件名。
 * 平假名/片假名同音，共用同一文件。清单为空时解析器返回 null，
 * 调用方回退实时 TTS。
 */
export const KANA_AUDIO_MANIFEST: Record<string, string> = {};
