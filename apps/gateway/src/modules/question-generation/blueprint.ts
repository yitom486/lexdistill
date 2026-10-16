import { BusinessError } from '@lexdistill/shared';
import type { BankCategory, GenerationBlueprint, GenerationConfig, GenerationPaperDetail } from '@lexdistill/protocol';

function fail(code: string, message: string): never {
  throw new BusinessError(code, message, 'VALIDATION');
}

/** 蓝图必须落在冻结配置的最大额度内；精确要求不能大于上限。 */
export function assertBlueprintFitsConfig(config: GenerationConfig, blueprint: GenerationBlueprint): void {
  if (blueprint.totalItems > config.maxPaperItems) fail('E_GENERATION_BLUEPRINT', '蓝图总题数超出试卷单张上限');
  if (blueprint.totalItems > config.maxQuestions) fail('E_GENERATION_BLUEPRINT', '蓝图总题数超出出题总额度');
  for (const [category, count] of Object.entries(blueprint.categoryCounts) as [BankCategory, number][]) {
    if ((count ?? 0) > (config.categoryLimits[category] ?? 0)) fail('E_GENERATION_BLUEPRINT', `蓝图${category}数量超出配置额度`);
  }
  if (blueprint.categoryCounts.LISTENING && blueprint.categoryCounts.LISTENING > 0 && config.maxAudio <= 0 && (blueprint.listeningModes ? Object.values(blueprint.listeningModes).some(n => n > 0) : true)) {
    // 蓝图要求听力但任务未配置音频额度：后端明确拒绝，不静默跳过听力。
    fail('E_GENERATION_BLUEPRINT', '蓝图要求听力但任务未配置音频额度');
  }
}

/** 核对最终试卷是否精确满足蓝图；上限满足不等于蓝图满足。 */
export function verifyPaperMeetsBlueprint(paper: GenerationPaperDetail, blueprint: GenerationBlueprint): void {
  if (paper.items.length !== blueprint.totalItems) fail('E_GENERATION_BLUEPRINT', `试卷题数${paper.items.length}与蓝图${blueprint.totalItems}不一致`);
  const counts = new Map<string, number>();
  for (const item of paper.items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  for (const [category, expected] of Object.entries(blueprint.categoryCounts)) {
    if ((counts.get(category) ?? 0) !== (expected ?? 0)) fail('E_GENERATION_BLUEPRINT', `试卷${category}数量与蓝图不一致`);
  }
  if (blueprint.listeningModes) {
    const modes = new Map<string, number>();
    for (const item of paper.items) {
      if (item.category !== 'LISTENING') continue;
      const mode = item.material?.type === 'LISTENING' ? item.material.mode : null;
      if (!mode) fail('E_GENERATION_BLUEPRINT', '听力题缺少可核对的材料形式');
      modes.set(mode, (modes.get(mode) ?? 0) + 1);
    }
    for (const [mode, expected] of Object.entries(blueprint.listeningModes)) {
      if ((modes.get(mode) ?? 0) !== (expected ?? 0)) fail('E_GENERATION_BLUEPRINT', `试卷听力${mode}数量与蓝图不一致`);
    }
  }
}
