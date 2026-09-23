/** Stable application surface for practice capabilities used across Gateway layers. */
export { submitPracticeAttempt } from './application/submit-practice-attempt.js';
export type {
  PracticeSubmissionRepository,
  SubmitPracticeAttemptInput,
} from './application/submit-practice-attempt.js';
export {
  handleQuizGenerate,
  handleQuizGradeSubjective,
  handleQuizSubmit,
} from './websocket/quiz-handlers.js';
export type {
  PracticeQuizSubmitWebSocketDependencies,
  PracticeQuizToolWebSocketDependencies,
} from './websocket/quiz-handlers.js';
