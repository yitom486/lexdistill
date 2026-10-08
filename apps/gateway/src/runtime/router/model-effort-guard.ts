/**
 * 模型/档位发前证伪（网关唯一口径；聊天回合与批处理共用）。
 * 仅证伪不断言：探针拿到真实列表且指名不在表里才判不可用；
 * 探针失败（空表）不拦；变体档（effortsVariant）只对探针时刻模型背书，不拦。
 */
export interface ProvenRuntimeOptions {
  models: Array<{ value: string; label: string }>;
  efforts: string[];
  effortsVariant?: boolean;
}

export function checkProvenOptions(
  proven: ProvenRuntimeOptions,
  preferredModel?: string,
  preferredEffort?: string,
): { dropModel: boolean; dropEffort: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let dropModel = false;
  let dropEffort = false;
  if (preferredModel && proven.models.length > 0
    && !proven.models.some(item => item.value === preferredModel)) {
    warnings.push(`模型 ${preferredModel} 在当前运行时不可用，已改用运行时默认模型`);
    dropModel = true;
  }
  if (preferredEffort && !proven.effortsVariant && proven.efforts.length > 0
    && !proven.efforts.includes(preferredEffort)) {
    warnings.push(`思考深度 ${preferredEffort} 在当前运行时不可用，已改用运行时默认`);
    dropEffort = true;
  }
  return { dropModel, dropEffort, warnings };
}
