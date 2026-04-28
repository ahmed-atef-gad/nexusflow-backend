export class PigeonTopicCreator {
  static match(pattern: string | RegExp): string[] {
    const patternString = pattern instanceof RegExp ? pattern.source : pattern;
    const matches = patternString.match(/:[^/]+/g);
    if (!matches) {
      return [];
    }
    return matches.map((key) => key.slice(1));
  }
}
