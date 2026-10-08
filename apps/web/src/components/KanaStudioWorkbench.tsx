import { sound, speechStudio } from "../utils/audio.js";
import { KanaCharacterGuideDialog } from "./ja/kana/KanaCharacterGuideDialog.js";
import { KanaMemoryGuideDialog } from "./ja/kana/KanaMemoryGuideDialog.js";
import { KanaRowGuideDialog } from "./ja/kana/KanaRowGuideDialog.js";
import { AnimatePresence } from 'framer-motion';
import type { AiTutorContext } from './AiTutorDrawer.js';
import { useKanaStudio } from '../hooks/useKanaStudio.js';
import { KanaStudioHeader } from './kana-studio/KanaStudioHeader.js';
import { KanaMatrix } from './kana-studio/KanaMatrix.js';
import { KanaDrill } from './kana-studio/KanaDrill.js';
import { PlanIntentBanner } from './PlanIntentBanner.js';
import { useStudySessionStore } from '../stores/useStudySessionStore.js';
export function KanaStudioWorkbench({ onOpenTutor }: {
    onOpenTutor?: (ctx: AiTutorContext) => void;
}) {
    const intent = useStudySessionStore(s => s.planIntent);
    return <KanaStudioSession key={intent?.stepId ?? 'free'} {...(onOpenTutor ? { onOpenTutor } : {})}/>;
}
function KanaStudioSession({ onOpenTutor }: {
    onOpenTutor?: (ctx: AiTutorContext) => void;
}) {
    const state = useKanaStudio(onOpenTutor);
    const { isDrillActive, scriptMode, activeKana, isKanaGuideOpen, setIsKanaGuideOpen, isMemoryGuideOpen, setIsMemoryGuideOpen, activeRowGuide, setActiveRowGuide, handlePlayAudio, handleAskTutor } = state;
    return (<div className="space-y-6"><PlanIntentBanner /><KanaStudioHeader state={state}/><AnimatePresence mode="wait">{isDrillActive ? <KanaDrill key="drill" state={state}/> : <KanaMatrix key="matrix" state={state}/>}</AnimatePresence><KanaMemoryGuideDialog open={isMemoryGuideOpen} onOpenChange={setIsMemoryGuideOpen}/>
        {activeRowGuide && (<KanaRowGuideDialog open onOpenChange={(open) => {
                if (!open)
                    setActiveRowGuide(null);
            }} rowName={activeRowGuide.rowName} items={activeRowGuide.items} scriptMode={scriptMode}/>)}
        {isKanaGuideOpen && activeKana && (<KanaCharacterGuideDialog key={`${activeKana.id}-${scriptMode}`} open={isKanaGuideOpen} onOpenChange={setIsKanaGuideOpen} kana={activeKana} scriptMode={scriptMode} onPlayAudio={handlePlayAudio} onPlayExample={(word) => {
                sound.playClick();
                void speechStudio.speak(word.reading, { lang: 'JA', purpose: 'preview' });
            }} onAskTutor={(kana, script) => handleAskTutor(kana, { script })}/>)}</div>);
}
