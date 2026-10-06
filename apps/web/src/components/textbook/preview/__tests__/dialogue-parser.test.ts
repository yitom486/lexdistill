import { describe, expect, it } from 'bun:test';
import { detectSpeakerGender, parseArticleDialogueSegments } from '../dialogue-parser.js';

describe('dialogue-parser', () => {
  it('detects gender accurately and contrasts in two-speaker context', () => {
    expect(detectSpeakerGender('ミラー', ['管理人', 'ミラー'])).toBe('male');
    // 管理人 contrasts with ミラー
    expect(detectSpeakerGender('管理人', ['管理人', 'ミラー'])).toBe('female');

    expect(detectSpeakerGender('マリア')).toBe('female');
    expect(detectSpeakerGender('田中')).toBe('male');
  });

  it('parses multi-turn dialogues with colon syntax into StudySegments', () => {
    const raw = `管理人：ミラーさん、引っ越しの荷物は片づきましたか。
ミラー：はい、だいたい片づきました。あのう、ごみを捨てたいんですが、どこに出したらいいですか。
管理人：燃えるごみは月曜日と木曜日の朝、出してください。
ミラー：瓶や缶はいつですか。`;

    const translation = `管理员：米勒先生，搬家的行李收拾好了吗？
米勒：是的，大概收拾好了。那个，我想扔垃圾，应该扔到哪里呢？
管理员：可燃垃圾在周一和周四的早上扔。
米勒：瓶子和罐子是什么时候？`;

    const segments = parseArticleDialogueSegments({ text: raw, translation });
    expect(segments).not.toBeNull();
    expect(segments!.length).toBe(4);

    expect(segments![0]).toEqual({
      speaker: '管理人',
      text: 'ミラーさん、引っ越しの荷物は片づきましたか。',
      translation: '米勒先生，搬家的行李收拾好了吗？',
      gender: 'female',
    });

    expect(segments![1]).toEqual({
      speaker: 'ミラー',
      text: 'はい、だいたい片づきました。あのう、ごみを捨てたいんですが、どこに出したらいいですか。',
      translation: '是的，大概收拾好了。那个，我想扔垃圾，应该扔到哪里呢？',
      gender: 'male',
    });

    expect(segments![3]?.speaker).toBe('ミラー');
    expect(segments![3]?.text).toBe('瓶や缶はいつですか。');
    expect(segments![3]?.translation).toBe('瓶子和罐子是什么时候？');
  });

  it('returns null for standard non-dialogue prose articles', () => {
    const prose = `富士山は日本で一番高い山です。
毎年夏になると、多くの観光客が富士山に登ります。
頂上からの景色はとてもきれいです。`;

    const segments = parseArticleDialogueSegments({ text: prose });
    expect(segments).toBeNull();
  });
});
