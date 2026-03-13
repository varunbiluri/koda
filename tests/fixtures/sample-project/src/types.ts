export interface Config {
  port: number;
  host: string;
  debug: boolean;
}

export type Handler = (req: Request) => Promise<Response>;
