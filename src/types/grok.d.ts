declare module '@okuryu/grok-js' {
  interface GrokPattern {
    parseSync(value: string): Record<string, unknown> | null;
  }

  interface GrokCollection {
    createPattern(expression: string, id?: string): GrokPattern;
    loadSync(path: string): number;
  }

  interface GrokModule {
    init(): Promise<void>;
    loadDefaultSync(modules?: string[]): GrokCollection;
  }

  const grok: GrokModule;
  export default grok;
}
