import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';



@Controller('users')
export class UsersController {
    @UseGuards(AuthGuard)
    @Get('profile')
    async getProfile(@Request() req) {
        return "This is the profile of user";
    }
}


