import pkg from '../package.json';
// Assets embedded into the compiled binary (and readable from disk in dev).
import devPrompt from '../prompts/dev.md' with { type: 'file' };
import fixPrompt from '../prompts/fix.md' with { type: 'file' };
import replanPrompt from '../prompts/replan.md' with { type: 'file' };
import reviewPrompt from '../prompts/review.md' with { type: 'file' };
import triagePrompt from '../prompts/triage.md' with { type: 'file' };

export const EMBEDDED_PROMPTS: Record<string, string> = {
  dev: devPrompt,
  fix: fixPrompt,
  replan: replanPrompt,
  review: reviewPrompt,
  triage: triagePrompt,
};

export const VERSION: string = pkg.version;
