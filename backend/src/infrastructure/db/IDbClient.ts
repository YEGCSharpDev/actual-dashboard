export interface IDbClient {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
}
