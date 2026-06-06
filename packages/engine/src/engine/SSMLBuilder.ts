// Abstract SSML Builder.
// Allows programmatic insertion of pauses and emphasis for technical writers.
export class SSMLBuilder {
  private parts: string[] = [];
  text(content: string) {
    this.parts.push(content);
    return this;
  }
  pause(ms: number) {
    this.parts.push(`<break time="${ms}ms"/>`);
    return this;
  }
  emphasize(content: string) {
    this.parts.push(`<emphasis>${content}</emphasis>`);
    return this;
  }
  build(): string {
    return `<speak>${this.parts.join(' ')}</speak>`;
  }
}
