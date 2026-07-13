import type { AgentContext } from './types.js';

export interface ContextSources {
  retrieveMemory?(goal: string, options?: { providerId?: string | null; projectId?: string | null }): Promise<string>;
  matchSkills?(goal: string): Promise<string>;
  describeTools?(options?: { names?: string[]; limit?: number }): string | Promise<string>;
  describeProject?(projectId?: string | null): Promise<string> | string;
}

export class ContextBuilder {
  constructor(private readonly sources: ContextSources) {}

  async build(goal: string, options: { providerId?: string | null; projectId?: string | null } = {}): Promise<AgentContext> {
    const [memoryContext, skillContext, toolContext, projectContext] = await Promise.all([
      this.sources.retrieveMemory?.(goal, options) ?? Promise.resolve(''),
      this.sources.matchSkills?.(goal) ?? Promise.resolve(''),
      Promise.resolve(this.sources.describeTools?.() ?? ''),
      Promise.resolve(this.sources.describeProject?.(options.projectId) ?? ''),
    ]);
    return {
      goal,
      memoryContext,
      skillContext,
      toolContext: typeof toolContext === 'string' ? toolContext : await toolContext,
      projectContext: typeof projectContext === 'string' ? projectContext : await projectContext,
      providerId: options.providerId ?? null,
      projectId: options.projectId ?? null,
    };
  }

  formatPrompt(context: AgentContext): string {
    return [
      context.projectContext,
      context.memoryContext,
      context.skillContext,
      context.toolContext,
      `用户目标：${context.goal}`,
    ].filter(Boolean).join('\n\n');
  }
}
