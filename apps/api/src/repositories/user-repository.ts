import type { Database } from "bun:sqlite";
import type { User, UserRole } from "../types/domain";

type UserRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar: string;
  role: UserRole;
  created_at: string;
};

function toUser(row: UserRow): User {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatar: row.avatar,
    role: row.role,
    createdAt: row.created_at,
  };
}

const selectUser = `
  SELECT id, handle, display_name, avatar, role, created_at
  FROM users
`;

export function createUserRepository(db: Database) {
  function findByHandle(handle: string): User | null {
    const row = db
      .query(`${selectUser} WHERE handle = $handle`)
      .get({ $handle: handle }) as UserRow | null;

    return row ? toUser(row) : null;
  }

  return {
    findByHandle,

    ensure(handle: string): User {
      const existing = findByHandle(handle);

      if (existing) {
        return existing;
      }

      db.query(`
        INSERT OR IGNORE INTO users (
          id,
          handle,
          display_name,
          avatar,
          role,
          created_at
        )
        VALUES ($id, $handle, $handle, $avatar, 'developer', $createdAt)
      `).run({
        $id: `user-${handle.toLowerCase()}`,
        $handle: handle,
        $avatar: handle.charAt(0).toUpperCase(),
        $createdAt: new Date().toISOString(),
      });

      const created = findByHandle(handle);

      if (!created) {
        throw new Error(`Unable to create user: ${handle}`);
      }

      return created;
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
