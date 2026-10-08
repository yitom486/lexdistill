import { Square, Volume2 } from 'lucide-react';
import { useStudySpeech } from '../../hooks/useStudySpeech.js';
import { Button } from '../ui/button.js';

export function StudySpeakButton({ text, language, scopeKey, label, caption = '朗读', speaker, variant = 'ghost' }: {
  text: string;
  language: 'ja' | 'en' | 'ko';
  scopeKey: string;
  label: string;
  caption?: string;
  speaker?: string;
  variant?: 'ghost' | 'outline';
}) {
  const { playing, toggle } = useStudySpeech(text, language, scopeKey, speaker);
  return <Button
    type="button" size="sm" variant={variant} className="shrink-0 gap-1.5"
    disabled={!text.trim()} onClick={toggle} aria-pressed={playing}
    aria-label={playing ? `停止${label}` : label}
  >
    {playing ? <Square className="h-3.5 w-3.5" aria-hidden="true" /> : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
    {playing ? '停止' : caption}
  </Button>;
}
