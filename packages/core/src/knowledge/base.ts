export interface KnowledgeSource {
  type: string;
  getContext(query: string): Promise<string>;
}
