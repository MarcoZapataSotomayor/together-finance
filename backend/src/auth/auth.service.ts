import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { verifyPassword } from './password.js';

interface Session {
  key: string;
  csrfToken: string;
  authenticated: boolean;
  expiresAt: number;
}

export interface SessionView {
  authenticated: boolean;
  csrfToken: string;
  expiresAt: string;
}

export function readSessionCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  const matches = (header ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}

@Injectable()
export class AuthService {
  private readonly sessions = new Map<string, Session>();
  private verifyingPassword = false;
  readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;
  private readonly secret: string;
  private readonly ttl: number;

  constructor(private readonly config: ConfigService) {
    const production = config.get('NODE_ENV') === 'production';
    this.cookieName = production
      ? '__Host-together_session'
      : 'together_session';
    this.cookieOptions = {
      httpOnly: true,
      secure: production,
      sameSite: config.getOrThrow<'lax' | 'strict' | 'none'>(
        'SESSION_COOKIE_SAME_SITE',
      ),
      path: '/',
    };
    this.secret = config.getOrThrow<string>('SESSION_SECRET');
    this.ttl = config.getOrThrow<number>('SESSION_TTL_SECONDS') * 1000;
  }

  private signature(id: string): string {
    return createHmac('sha256', this.secret).update(id).digest('base64url');
  }
  private key(id: string): string {
    return createHash('sha256').update(id).digest('hex');
  }

  private prune(): void {
    for (const [key, session] of this.sessions)
      if (session.expiresAt <= Date.now()) this.sessions.delete(key);
  }

  findSession(request: Request): Session | undefined {
    const cookie = readSessionCookie(request.headers.cookie, this.cookieName);
    if (!cookie || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(cookie))
      return undefined;
    const [id, signature] = cookie.split('.');
    const expected = this.signature(id);
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      return undefined;
    const session = this.sessions.get(this.key(id));
    if (session && session.expiresAt > Date.now()) return session;
    if (session) this.sessions.delete(session.key);
    return undefined;
  }

  private createSession(response: Response, authenticated: boolean): Session {
    this.prune();
    if (this.sessions.size >= 512) {
      const anonymous = [...this.sessions.values()].find(
        (session) => !session.authenticated,
      );
      if (anonymous) this.sessions.delete(anonymous.key);
      else throw new ServiceUnavailableException('Session capacity reached.');
    }
    const id = randomBytes(32).toString('base64url');
    const session: Session = {
      key: this.key(id),
      csrfToken: randomBytes(32).toString('base64url'),
      authenticated,
      expiresAt: Date.now() + (authenticated ? this.ttl : 10 * 60 * 1000),
    };
    this.sessions.set(session.key, session);
    response.cookie(this.cookieName, `${id}.${this.signature(id)}`, {
      ...this.cookieOptions,
      expires: new Date(session.expiresAt),
      maxAge: session.expiresAt - Date.now(),
    });
    return session;
  }

  private view(session: Session): SessionView {
    return {
      authenticated: session.authenticated,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  session(request: Request, response: Response): SessionView {
    return this.view(
      this.findSession(request) ?? this.createSession(response, false),
    );
  }

  requireSession(request: Request): void {
    if (!this.findSession(request)?.authenticated)
      throw new UnauthorizedException('Authentication required.');
  }

  verifyCsrf(request: Request): void {
    const origin = request.get('Origin');
    const allowed = this.config.getOrThrow<string[]>('CORS_ORIGINS');
    if (!origin || !allowed.includes(origin))
      throw new ForbiddenException('Request origin is not allowed.');
    const session = this.findSession(request);
    const token = request.get('X-CSRF-Token');
    if (
      !session ||
      !token ||
      !/^[A-Za-z0-9_-]{43}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken))
    )
      throw new ForbiddenException('CSRF verification failed.');
    if (request.method !== 'DELETE' && !request.is('application/json'))
      throw new ForbiddenException('JSON content type is required.');
  }

  async login(
    password: string,
    request: Request,
    response: Response,
  ): Promise<SessionView> {
    if (this.verifyingPassword) {
      response.setHeader('Retry-After', '2');
      throw new HttpException(
        'Please wait before retrying.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.verifyingPassword = true;
    let valid: boolean;
    try {
      valid = await verifyPassword(
        password,
        this.config.getOrThrow<string>('SHARED_PASSWORD_HASH'),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Authentication temporarily unavailable.',
      );
    } finally {
      this.verifyingPassword = false;
    }
    if (!valid) throw new UnauthorizedException('Invalid shared password.');
    // Rotate both the opaque session ID and CSRF token after authentication.
    const previous = this.findSession(request);
    if (!previous)
      throw new ForbiddenException('Session expired during login.');
    this.sessions.delete(previous.key);
    return this.view(this.createSession(response, true));
  }

  logout(request: Request, response: Response): void {
    const session = this.findSession(request);
    if (session) this.sessions.delete(session.key);
    response.clearCookie(this.cookieName, this.cookieOptions);
  }
}
