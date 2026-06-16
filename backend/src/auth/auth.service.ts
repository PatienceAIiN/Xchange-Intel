import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { SignupDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
  ) {}

  private sign(userId: string) {
    const minutes = parseInt(process.env.ACCESS_TOKEN_EXPIRE_MINUTES || '60', 10);
    return this.jwt.sign({ sub: userId }, { expiresIn: `${minutes}m` });
  }

  async signup(dto: SignupDto) {
    if (!dto.consent)
      throw new BadRequestException('Consent is required to process data (DPDP/GDPR).');
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    // first user becomes admin for convenience
    const isFirst = (await this.users.count()) === 0;
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.users.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName || '',
      role: isFirst ? 'admin' : 'user',
      consentGiven: true,
      consentAt: new Date(),
    });
    return { accessToken: this.sign(user.id), user: this.publicUser(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (!user.isActive) throw new UnauthorizedException('Account disabled');
    return { accessToken: this.sign(user.id), user: this.publicUser(user) };
  }

  publicUser(u: any) {
    return {
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      plan: u.plan,
      searchCount: u.searchCount,
    };
  }
}
