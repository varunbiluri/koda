import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface UserConfig {
  name: string;
  email: string;
  age?: number;
}

export type UserId = string | number;

export enum Role {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

export class UserService {
  private users: Map<string, UserConfig> = new Map();

  addUser(id: string, config: UserConfig): void {
    this.users.set(id, config);
  }

  getUser(id: string): UserConfig | undefined {
    return this.users.get(id);
  }

  async loadFromFile(filePath: string): Promise<void> {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    for (const [id, config] of Object.entries(data)) {
      this.users.set(id, config as UserConfig);
    }
  }
}

export function createDefaultUser(name: string): UserConfig {
  return { name, email: `${name.toLowerCase()}@example.com` };
}

const DEFAULT_ROLE = Role.User;

export const getUserRole = (userId: UserId): Role => {
  return DEFAULT_ROLE;
};
