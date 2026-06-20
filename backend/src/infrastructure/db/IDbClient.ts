export type SqlParam = string | number | boolean | null;

export interface IDbClient {
  query<T = any>(sql: string, params?: SqlParam[]): Promise<T[]>;
}
