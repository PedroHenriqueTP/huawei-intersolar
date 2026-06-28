import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { SessionService } from './session.service';
import { ActivationType } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsEnum,
} from 'class-validator';

class RegisterUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsNotEmpty()
  keyPassToken: string;
}

class BindSessionDto {
  @IsString()
  @IsNotEmpty()
  keyPassToken: string;

  @IsString()
  @IsNotEmpty()
  machineId: string;

  @IsEnum(ActivationType)
  activationType: ActivationType;
}

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterUserDto) {
    return this.sessionService.registerUser(registerDto);
  }

  @Post('bind')
  async bind(@Body() bindDto: BindSessionDto) {
    return this.sessionService.bindSession(bindDto);
  }

  @Get('active/:machineId')
  async getActive(@Param('machineId') machineId: string) {
    return this.sessionService.getActiveSession(machineId);
  }

  @Get('leaderboard/:activationType')
  async getLeaderboard(
    @Param('activationType') activationType: ActivationType,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.sessionService.getLeaderboard(activationType, limit);
  }
}
