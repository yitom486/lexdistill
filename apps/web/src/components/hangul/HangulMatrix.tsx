import { AnimatePresence, motion } from 'framer-motion';
import { Volume2 } from 'lucide-react';
import { Button } from '../ui/button.js';
import { Tabs, TabsList, TabsTrigger, TabsIndicator } from '../ui/tabs.js';
import { sound, speechStudio } from '../../utils/audio.js';
import type { HangulItem } from '@study-studio/protocol';
import type { MatrixTab } from './hangul-drill.js';

interface HangulMatrixProps {
  pool: HangulItem[];
  matrixTab: MatrixTab;
  onTabChange: (tab: MatrixTab) => void;
  showRomaji: boolean;
  activeHangul: HangulItem | null;
  onSelect: (item: HangulItem) => void;
}

const ADVANCED_GROUPS = [
  { type: 'YVOWEL', label: 'y 系母音 ㅑㅕㅛㅠ' },
  { type: 'COMPOUND', label: '复合母音 ㅒㅖㅘㅙㅝㅞㅢ' },
  { type: 'CODA', label: '收音代表音（只发代表音）' },
] as const;

function JamoButton({ item, active, showRomaji, onSelect }: {
  item: HangulItem;
  active: boolean;
  showRomaji: boolean;
  onSelect: (item: HangulItem) => void;
}) {
  return (
    <button
      key={item.id}
      onClick={() => {
        onSelect(item);
        void speechStudio.speak(item.audioText || item.jamo, { lang: 'KO', purpose: 'preview' });
        sound.playClick();
      }}
      aria-pressed={active}
      aria-label={`${item.jamo} ${item.name}`}
      className={`rounded-xl border p-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring hover:border-line-hairline-strong ${
        active ? 'border-tone-amber-500 bg-wash-amber-500o10' : ''
      }`}
    >
      <div className="text-2xl font-bold">{item.jamo}</div>
      {showRomaji && <div className="text-xs text-ink-ghost mt-1">{item.romanization}</div>}
    </button>
  );
}

/** 谚文字母矩阵（纯展示）：选项卡、字母网格、选中详情。 */
export function HangulMatrix({ pool, matrixTab, onTabChange, showRomaji, activeHangul, onSelect }: HangulMatrixProps) {
  return (
    <>
      {/* 矩阵选项卡 */}
      <Tabs value={matrixTab} onValueChange={(v) => v && onTabChange(v as MatrixTab)}>
        <TabsList>
          <TabsIndicator />
          <TabsTrigger value="CONSONANT">子音 자음</TabsTrigger>
          <TabsTrigger value="VOWEL">母音 모음</TabsTrigger>
          <TabsTrigger value="ADVANCED">进阶 복모음·받침</TabsTrigger>
        </TabsList>
      </Tabs>

      {matrixTab === 'ADVANCED' && (
        <div className="rounded-xl border border-dashed p-3 text-xs text-ink-ghost leading-relaxed">
          进阶区 = y 系母音（ㅑㅕㅛㅠ）+ 复合母音（ㅒㅖㅘㅙㅝㅞㅢ；ㅐㅔㅚㅟ 已在母音区）+ 收音 7 代表音（ㄱㄴㄷㄹㅁㅂㅇ）。
          收音只发代表音：点字母卡看变音要点（如鼻音化、颚化），自测成绩记入「复音与收音」画像。
        </div>
      )}

      {/* 字母矩阵（进阶区按 y 系 / 复合 / 收音分组） */}
      {matrixTab === 'ADVANCED' ? (
        <div className="space-y-4">
          {ADVANCED_GROUPS.map((group) => (
            <div key={group.type} className="space-y-2">
              <div className="text-xs font-medium text-ink-ghost">{group.label}</div>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {pool
                  .filter((h) => h.type === group.type)
                  .map((h) => (
                    <JamoButton key={h.id} item={h} active={activeHangul?.id === h.id} showRomaji={showRomaji} onSelect={onSelect} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {pool.map((h) => (
            <JamoButton key={h.id} item={h} active={activeHangul?.id === h.id} showRomaji={showRomaji} onSelect={onSelect} />
          ))}
        </div>
      )}

      {/* 选中字母详情 */}
      <AnimatePresence>
        {activeHangul && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-xl border p-4 flex items-center gap-4"
          >
            <div className="text-4xl font-bold">{activeHangul.jamo}</div>
            <div className="flex-1">
              <div className="font-medium">
                {activeHangul.name} · {activeHangul.romanization}
              </div>
              {activeHangul.mnemonic && (
                <div className="text-sm text-ink-ghost mt-0.5">{activeHangul.mnemonic}</div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void speechStudio.speak(activeHangul.audioText || activeHangul.jamo, { lang: 'KO', purpose: 'preview' })}
            >
              <Volume2 className="h-3.5 w-3.5 mr-1" />
              跟读
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
