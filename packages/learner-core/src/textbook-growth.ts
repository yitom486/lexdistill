import type { TextbookExerciseAttempt, TextbookGrowth } from '@study-studio/protocol';

/** Only comparable, validated scores contribute; retries have no separate attempt identity. */
export function summarizeTextbookGrowth(attempts: readonly TextbookExerciseAttempt[]): TextbookGrowth {
  const unique = [...new Map(attempts.filter(row => !row.temporary).map(row => [row.id, row])).values()];
  const valid = unique.filter(row => row.status === 'GRADED' && row.grading !== null && row.grading.maxScore === 100);
  const grouped = new Map<string, TextbookExerciseAttempt[]>();
  for (const row of valid) {
    const key = JSON.stringify([row.snapshot.chapterId, row.snapshot.exercise.type, row.snapshot.exercise.difficultyTier, row.submissionKind, row.model, row.adapter, row.rubricVersion]);
    const group = grouped.get(key) ?? []; group.push(row); grouped.set(key, group);
  }
  return {
    independentAttempts: valid.filter(row => row.submissionKind === 'INDEPENDENT').length,
    revisionAttempts: valid.filter(row => row.submissionKind === 'REVISION').length,
    ungradedAttempts: unique.length - valid.length,
    groups: [...grouped.values()].map(rows => {
      const first = rows[0]!;
      const timings = rows.map(row => row.timeSpentMs).filter((time): time is number => time !== null);
      const dates = new Map<string, number[]>();
      for (const row of rows) {
        const date = row.submittedAt.slice(0, 10), scores = dates.get(date) ?? [];
        scores.push(row.grading!.score); dates.set(date, scores);
      }
      return { chapterId: first.snapshot.chapterId, chapterTitle: first.snapshot.chapterTitle, type: first.snapshot.exercise.type,
        difficultyTier: first.snapshot.exercise.difficultyTier, submissionKind: first.submissionKind, model: first.model, adapter: first.adapter,
        rubricVersion: first.rubricVersion, samples: rows.length,
        averageScore: rows.reduce((sum, row) => sum + row.grading!.score, 0) / rows.length,
        fullMarkRate: rows.filter(row => row.grading!.score === 100).length / rows.length,
        averageTimeSpentMs: timings.length ? timings.reduce((sum, time) => sum + time, 0) / timings.length : null,
        timeline: [...dates].sort(([a],[b]) => a.localeCompare(b)).map(([date, scores]) => ({ date, samples: scores.length, averageScore: scores.reduce((sum, score) => sum + score, 0) / scores.length })) };
    }),
  };
}

export function haveSameGradingBasis(a: TextbookExerciseAttempt, b: TextbookExerciseAttempt): boolean {
  return a.model === b.model && a.adapter === b.adapter && a.rubricVersion === b.rubricVersion
    && JSON.stringify(a.snapshot) === JSON.stringify(b.snapshot);
}
