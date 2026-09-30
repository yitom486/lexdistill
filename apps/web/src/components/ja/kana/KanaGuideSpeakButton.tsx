import React from 'react';
import { Volume2 } from 'lucide-react';
import { speechStudio, sound } from '../../../utils/audio.js';
import { playKanaText } from '../../../lib/kana-audio.js';
import { Button } from '../../ui/button.js';

export interface KanaGuideSpeakButtonProps {
  text: string;
  label: string;
  className?: string;
}

/**
 * 假名讲义发音按钮：纯假名字串（单字/整行）播安装包内置音频，
 * 解不出（单词等）才回退实时 TTS。调用方只管传 text。
 */
export function KanaGuideSpeakButton({ text, label, className }: KanaGuideSpeakButtonProps) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={() => {
        sound.playClick();
        // 行文本（あ行整行等）走内置连播；单词等走实时 TTS（保整词语调）。
        void playKanaText(text, { sequence: text.trim().length > 1 }).then((played) => {
          if (!played) void speechStudio.speak(text, { lang: 'JA', purpose: 'preview' });
        });
      }}
      className={`h-7 w-7 rounded-full text-tone-amber-700 hover:bg-wash-amber-500o15 hover:text-ink-amber-800 dark:text-ink-amber-300 dark:hover:text-ink-amber-200 transition-colors${className ?` ${className}` : ''}`}
      aria-label={label}
      title={label}
    >
      <Volume2 className="h-3.5 w-3.5" />
    </Button>
  );
}
