declare module "word-extractor" {
  interface ExtractedWordDocument {
    getBody(options?: unknown): string;
  }

  export default class WordExtractor {
    extract(source: Buffer | string): Promise<ExtractedWordDocument>;
  }
}
