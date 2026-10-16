import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolExecutionContext,
  ToolPermissions,
  ToolLocations,
} from '@lexdistill/tool-core';
import {
  type GeneratedQuestion,
  GeneratedQuestionSchema,
} from '@lexdistill/protocol';
import {
  ok,
  err,
  type Result,
  BusinessError,
  generateId,
  isOk,
} from '@lexdistill/shared';
import type { LearnerRepository } from '@lexdistill/learner-core';
import {
  filterQuestionsByLevel,
  isLessonLocked,
  isQuestionAllowed,
  isSkillAllowedForLevel,
  NOVICE_SAFE_SKILL,
  resolveStudyGate,
} from '@lexdistill/learner-core';

export const GenerateAdaptiveQuizInputSchema = z.object({
  targetLanguage: z.enum(['ja', 'en', 'ko']),
  targetLevel: z.string(),
  weaknessSkillId: z.string().optional(),
  count: z.number().min(1).max(5),
});

export type GenerateAdaptiveQuizInput = z.infer<typeof GenerateAdaptiveQuizInputSchema>;

export interface GenerateAdaptiveQuizOutput {
  targetSkillId: string;
  targetSkillName: string;
  adaptationReason: string;
  questions: GeneratedQuestion[];
}

// 预设的高质量靶向自适应题库池（依据外语教学薄弱点分类建立）
const ADAPTIVE_QUESTION_BANK: Record<string, { skillName: string; questions: Omit<GeneratedQuestion, 'id'>[] }> = {
  'jp.particle.ni_vs_de': {
    skillName: '场所格助词「で」与「に」的功能辨析',
    questions: [
      {
        type: 'MULTIPLE_CHOICE',
        prompt: '根据谓语动词的动作属性，选择最恰当的场所助词：',
        content: '昨日の夜、静かなカフェ（　）本を読みました。',
        options: ['で', 'に', 'を', 'へ'],
        correctAnswer: 'で',
        explanation: '「本を読む」(读书) 属于动态发生的作用力动作，动作发生的场所必须使用格助词「で」；「に」则表示静态存在或归着落脚点。',
        testedSkillId: 'jp.particle.ni_vs_de',
        difficultyTier: 3,
      },
      {
        type: 'MULTIPLE_CHOICE',
        prompt: '选择最恰当的格助词填入括号（表示存在场所）：',
        content: '机の上（　）日本語の教科書があります。',
        options: ['に', 'で', 'へ', 'から'],
        correctAnswer: 'に',
        explanation: '句尾为静态存在动词「ある」，表示无生命物体的静态存在场所，固定使用格助词「に」。',
        testedSkillId: 'jp.particle.ni_vs_de',
        difficultyTier: 2,
      },
    ],
  },
  'jp.grammar.conditional_tara': {
    skillName: '假定条件句形「～たら」接续与应用',
    questions: [
      {
        type: 'FILL_IN_BLANK',
        prompt: '将括号中的一类形容词变形为假定形（～たら）：',
        content: '値段が（高い ──►　　　　）、買いません。',
        correctAnswer: '高かったら',
        explanation: '一类形容词的假定形变化为：将词尾「い」变为过去式「かった」，后接「ら」，即「高かったら」。',
        testedSkillId: 'jp.grammar.conditional_tara',
        difficultyTier: 3,
      },
    ],
  },
  'jp.grammar.causative_active': {
    skillName: '使役态与被动态语境辨析',
    questions: [
      {
        type: 'MULTIPLE_CHOICE',
        prompt: '选择符合上下文语法逻辑的使役动词形式：',
        content: '母親は子どもに毎日野菜を（　）。',
        options: ['食べさせます', '食べられます', '食べさせられます', '食べられますか'],
        correctAnswer: '食べさせます',
        explanation: '母亲让孩子吃蔬菜，符合「Aは Bに ...を [使役动词]」的使役逻辑，二类动词「食べる」使役形为「食べさせる」。',
        testedSkillId: 'jp.grammar.causative_active',
        difficultyTier: 4,
      },
    ],
  },
  'DEFAULT': {
    skillName: '格助词综合理解与语境搭配',
    questions: [
      {
        type: 'MULTIPLE_CHOICE',
        prompt: '选择最恰当的助词完成移动句：',
        content: '来週の金曜日、家族と一緒に東京（　）新幹線で行きます。',
        options: ['へ', 'で', 'を', 'から'],
        correctAnswer: 'へ',
        explanation: '移动目的地可用方向助词「へ」(读音 e) 或到达点助词「に」；交通工具「新幹線」后接「で」。',
        testedSkillId: 'jp.particle.destination',
        difficultyTier: 3,
      },
    ],
  },
};

export class GenerateAdaptiveQuizTool
  implements ToolDefinition<GenerateAdaptiveQuizInput, GenerateAdaptiveQuizOutput>
{
  public readonly name = 'quiz.generateAdaptive';
  public readonly description =
    '【兼容别名】靶向出题；Agent/新路径请优先 learning.content（action=generate_quiz）。本工具保留 HTTP/WS 旧输入形态。';
  public readonly location = ToolLocations.SERVER;
  public readonly permission = ToolPermissions.READ;
  public readonly schema = GenerateAdaptiveQuizInputSchema;

  constructor(private readonly learnerRepo: LearnerRepository) {}

  public async execute(
    input: GenerateAdaptiveQuizInput,
    context: ToolExecutionContext
  ): Promise<Result<GenerateAdaptiveQuizOutput, BusinessError>> {
    try {
      // 出题门：档位 + 讲义锁一次取齐；读不到降级为纯档位门（旧行为）。
      // 用户自选的 weaknessSkillId 是明确意图，全豁免；只拦系统代选的。
      const explicitSkill = (input.weaknessSkillId ?? '').trim() || undefined;
      const track =
        input.targetLanguage === 'ko' ? 'ko' : input.targetLanguage === 'en' ? 'en' : 'ja';
      const gate = await resolveStudyGate(
        this.learnerRepo,
        context.userId,
        input.targetLanguage,
        input.targetLevel
      );
      const gateLevel = gate.level;
      let targetSkillId = explicitSkill;
      let reason = '用户指定专项练习';

      // 如果未指定薄弱项，从学习者画像数据库提取首个“讲义不锁”的弱项
      // （锁定的弱项先指去学讲义，不直接推题；全锁定时走默认降级链）。
      let lockedNote = '';
      if (!targetSkillId) {
        const snapshotRes = await this.learnerRepo.getProfileSnapshot(
          context.userId,
          input.targetLanguage
        );
        if (isOk(snapshotRes)) {
          const weaknesses = snapshotRes.value.weaknesses ?? [];
          const open = weaknesses.find((w) => w && !isLessonLocked(w.id, gate));
          if (open) {
            targetSkillId = open.id;
            reason = `基于您的学情画像：考点【${open.name}】近期连续出错 ${open.consecutiveErrors} 次，准确度偏低，系统为您定向生成靶向加练`;
          } else {
            const lockedNames = weaknesses
              .filter((w) => w && isLessonLocked(w.id, gate))
              .map((w) => `【${w.name}】`);
            if (lockedNames.length > 0) {
              lockedNote = `画像弱项${lockedNames.join('、')}讲义还没学完，已跳过；`;
            }
          }
          // 全锁定时 targetSkillId 保持空，走默认降级链（降级注记由下方案例统一报告）。
        }
      }

      if (!targetSkillId) {
        targetSkillId = 'jp.particle.ni_vs_de';
        reason = '系统针对高频混淆考点推荐靶向自测';
      }

      // 用户自选：整题照出（明确意图，档位门与讲义锁全豁免）。
      if (explicitSkill) {
        const bankEntry =
          ADAPTIVE_QUESTION_BANK[targetSkillId] ?? ADAPTIVE_QUESTION_BANK['DEFAULT']!;
        const selected = bankEntry.questions.slice(0, input.count);
        const generatedQuestions: GeneratedQuestion[] = selected.map((q) => {
          const raw = { ...q, id: generateId('q_ai') };
          return GeneratedQuestionSchema.parse(raw);
        });
        return ok({
          targetSkillId,
          targetSkillName: bankEntry.skillName,
          adaptationReason: reason,
          questions: generatedQuestions,
        });
      }

      // 系统代选：按 [画像弱项/默认 → 本轨道安全默认] 顺序，取第一个
      // “档位够 + 讲义已学完（或无讲义）+ 题库有货”的考点；全灭不断链（空题 + 指路讲义）。
      const ordered = [targetSkillId, NOVICE_SAFE_SKILL[track]].filter(
        (s, i, arr) => arr.indexOf(s) === i
      );
      let pickedSkill: string | null = null;
      let pickedRows: Array<(typeof ADAPTIVE_QUESTION_BANK)['DEFAULT']['questions'][number]> = [];
      const notes: string[] = [];
      for (const skill of ordered) {
        if (!isSkillAllowedForLevel(skill, gateLevel)) {
          notes.push(`【${skill}】对当前档位超纲`);
          continue;
        }
        if (isLessonLocked(skill, gate)) {
          notes.push(`【${skill}】讲义还没学完`);
          continue;
        }
        const entry = ADAPTIVE_QUESTION_BANK[skill] ?? ADAPTIVE_QUESTION_BANK['DEFAULT']!;
        const rows = filterQuestionsByLevel(entry.questions, gateLevel, (q) => ({
          skillId: q.testedSkillId,
          tier: q.difficultyTier,
        }));
        if (rows.length === 0) continue;
        pickedSkill = skill;
        pickedRows = rows;
        break;
      }
      if (!pickedSkill) {
        const firstLocked = ordered.find((s) => isLessonLocked(s, gate)) ?? ordered[0]!;
        return ok({
          targetSkillId: firstLocked,
          targetSkillName: '先学讲义',
          adaptationReason:
            `${lockedNote}${notes.join('；') || '暂无合适考点'}。先去语法讲义学完【${firstLocked}】再来，` +
            `学完自动解锁这类题；也可以直接点该考点专项练习`,
          questions: [],
        });
      }
      if (pickedSkill !== targetSkillId) {
        reason =
          `${lockedNote}${notes.join('；')}，已先换成基础考点【${pickedSkill}】热身；` +
          `跟着带路学完再回来，或直接点该考点专项练习`;
        targetSkillId = pickedSkill;
      }
      const bankEntry = ADAPTIVE_QUESTION_BANK[targetSkillId] ?? ADAPTIVE_QUESTION_BANK['DEFAULT']!;
      // 题库行再过一次完整门（技能 + tier + 讲义锁），保证出口干净。
      const selected = pickedRows
        .filter((q) => isQuestionAllowed(q.testedSkillId, q.difficultyTier, gateLevel, gate))
        .slice(0, input.count);

      const generatedQuestions: GeneratedQuestion[] = selected.map((q) => {
        const raw = {
          ...q,
          id: generateId('q_ai'),
        };
        // 刚性通过 Zod 校验，确保绝不出现字段缺失或格式错乱
        return GeneratedQuestionSchema.parse(raw);
      });

      return ok({
        targetSkillId,
        targetSkillName: bankEntry.skillName,
        adaptationReason: reason,
        questions: generatedQuestions,
      });
    } catch (error) {
      return err(
        new BusinessError(
          'E_ADAPTIVE_GENERATE_FAILED',
          `AI 靶向出题合成异常：${error instanceof Error ? error.message : String(error)}`,
          'AGENT_RUNTIME'
        )
      );
    }
  }
}
