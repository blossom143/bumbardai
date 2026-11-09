import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { credentials, profileInput } from '@hallway/shared';
import { Prisma, type User } from '@prisma/client';
import { z } from 'zod';
import { db } from '../../shared/db.js';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
const cookieName = 'hallway_session';
const lifetime = 60 * 60 * 24 * 14;
const passwordOptions = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const dummyHash = hash(secret(), passwordOptions);

function cookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.PUBLIC_ORIGIN?.startsWith('https:') ?? false,
  };
}

async function startSession(request: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = secret();
  const previous = request.cookies[cookieName];
  await db.$transaction([
    ...(previous ? [db.loginSession.deleteMany({ where: { digest: digest(previous) } })] : []),
    db.loginSession.create({
      data: { digest: digest(token), userId, expiresAt: new Date(Date.now() + lifetime * 1000) },
    }),
  ]);
  reply.setCookie(cookieName, token, { ...cookieOptions(), maxAge: lifetime });
}

export async function requireUser(request: FastifyRequest): Promise<User> {
  const token = request.cookies[cookieName];
  const session =
    token &&
    (await db.loginSession.findUnique({
      where: { digest: digest(token) },
      include: { user: true },
    }));
  if (!session || session.expiresAt <= new Date()) throw new HttpError(401, 'Sign in to continue.');
  return session.user;
}

export const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  demo: user.demo,
  profile: user.profile,
  reminderPrefs: user.reminderPrefs,
});

export function authRoutes(app: FastifyInstance) {
  app.get('/api/me', async (request) => publicUser(await requireUser(request)));
  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password, demo } = credentials
        .extend({ demo: z.boolean().default(false) })
        .parse(request.body);
      if (email.endsWith('@demo.invalid'))
        throw new HttpError(400, 'Use a different email address.');
      try {
        const user = await db.user.create({
          data: { email, demo, passwordHash: await hash(password, passwordOptions) },
        });
        await startSession(request, reply, user.id);
        return reply.code(201).send(publicUser(user));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new HttpError(409, 'An account already uses that email.');
        }
        throw error;
      }
    },
  );
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password } = credentials.parse(request.body);
      const user = await db.user.findUnique({ where: { email } });
      if (
        !(await verify(
          user?.passwordHash.startsWith('$argon2') ? user.passwordHash : await dummyHash,
          password,
        )) ||
        !user
      )
        throw new HttpError(401, 'Invalid email or password.');
      await startSession(request, reply, user.id);
      return publicUser(user);
    },
  );
  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[cookieName];
    if (token) await db.loginSession.deleteMany({ where: { digest: digest(token) } });
    return reply.clearCookie(cookieName, cookieOptions()).code(204).send();
  });
  app.get(
    '/api/github/:login',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request) => {
      await requireUser(request);
      const { login } = z
        .object({ login: z.string().regex(/^[a-z\d](?:[a-z\d-]{0,38})$/i) })
        .parse(request.params);
      const result = await fetch('https://api.github.com/users/' + login, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Hallway-Quest' },
      }).catch(() => null);
      if (!result?.ok) throw new HttpError(502, 'GitHub profile is unavailable.');
      const profile = z
        .object({ name: z.string().nullable(), login: z.string(), bio: z.string().nullable() })
        .parse(await result.json());
      return {
        nickname: (profile.name || profile.login).slice(0, 60),
        background: (profile.bio || '').slice(0, 240),
      };
    },
  );
  app.put('/api/profile', async (request) => {
    const user = await requireUser(request);
    const profile = profileInput.parse(request.body);
    return publicUser(await db.user.update({ where: { id: user.id }, data: { profile } }));
  });
}
