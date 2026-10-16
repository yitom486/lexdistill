import { useState } from 'react';
import { toast } from 'sonner';
import {
  useCollectDictionaryEntryMutation,
  useMarkCardStudiedMutation,
  usePushToAnkiMutation,
  type AnkiPushTts,
} from '../../queries/useLearnerQueries.js';
import { useTtsStore } from '../../stores/useTtsStore.js';
import { sound } from '../../utils/audio.js';

/**
 * 词典条目三动作（收藏/学透入库/推送 Anki）：查词面板与讲透卡共用同一实现，
 * 不复制收藏/推送逻辑。保存结果以 mutation 回执为准，不用文案伪造。
 */
export function useDictionaryEntryActions() {
  const collect = useCollectDictionaryEntryMutation();
  const markStudied = useMarkCardStudiedMutation();
  const pushToAnki = usePushToAnkiMutation();
  // TTS 凭证只存浏览器本地：推送时随请求携带、网关不落盘；未配置则音频留空。
  const preferredService = useTtsStore((s) => s.preferredService);
  const providerApiKeys = useTtsStore((s) => s.providerApiKeys);
  const azureRegion = useTtsStore((s) => s.azureRegion);
  const localBaseUrl = useTtsStore((s) => s.localBaseUrl);
  const voiceId = useTtsStore((s) => s.voiceId);
  const [collectedIds, setCollectedIds] = useState<string[]>([]);
  const markCollected = (entryId: string) =>
    setCollectedIds((prev) => (prev.includes(entryId) ? prev : [...prev, entryId]));

  const collectEntry = (entryId: string) => {
    collect.mutate(entryId, {
      onSuccess: (result) => {
        markCollected(entryId);
        toast.success(
          result.created
            ? '已加入生词本，今天即可在 FSRS 闪卡中复习（回“我的学情”，相遇词会变绿）。'
            : '该词已经在你的生词本中。'
        );
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : '暂时无法加入生词本，请稍后重试。');
      },
    });
  };

  // 学透了，入库开练（M2 学习门）：先收（已收则直接返回旧卡），再标讲透；
  // 讲透的卡才进练习池 NEW 块，裸收的不进。
  const studyCompleteEntry = (entryId: string) => {
    if (collect.isPending || markStudied.isPending) return;
    sound.playClick();
    collect.mutate(entryId, {
      onSuccess: (result) => {
        markCollected(entryId);
        markStudied.mutate(result.card.id, {
          onSuccess: () => {
            sound.playCorrect();
            toast.success('已学透入库：这张卡可以进练习池了，去复习或开练吧');
          },
          onError: (e) => {
            sound.playMistake();
            toast.error(e instanceof Error ? e.message : '标记讲透失败');
          },
        });
      },
      onError: (error) => {
        sound.playMistake();
        toast.error(error instanceof Error ? error.message : '暂时无法加入生词本，请稍后重试。');
      },
    });
  };

  /** 推送到本机 Anki：先入库生词本（去重），再按卡片模板渲染推送。 */
  const pushEntryToAnki = (entryId: string) => {
    const tts: AnkiPushTts = {
      provider: preferredService,
      ...(providerApiKeys[preferredService] ? { apiKey: providerApiKeys[preferredService] } : {}),
      ...(azureRegion ? { region: azureRegion } : {}),
      ...(localBaseUrl ? { localBaseUrl } : {}),
      ...(providerApiKeys.local ? { localApiKey: providerApiKeys.local } : {}),
      ...(voiceId ? { voice: voiceId } : {}),
    };
    collect.mutate(entryId, {
      onSuccess: (result) => {
        pushToAnki.mutate(
          { cardId: result.card.id, tts },
          {
            onSuccess: (r) => {
              toast.success(
                `已推送到 Anki「${r.deckName}」${r.audioStored ? '（含发音）' : '（无音频）'}`
              );
              if (r.ttsWarning) toast.warning(r.ttsWarning);
              if (r.audioSkippedReason) toast.warning(r.audioSkippedReason);
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : '推送到 Anki 失败。');
            },
          }
        );
      },
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : '暂时无法加入生词本，请稍后重试。');
      },
    });
  };

  return {
    collectEntry,
    studyCompleteEntry,
    pushEntryToAnki,
    collectedIds,
    collectPending: collect.isPending,
    studyPending: collect.isPending || markStudied.isPending,
    pushPending: pushToAnki.isPending,
  };
}
