import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { join } from 'path';
import { existsSync } from 'fs';
import { EmailsService } from './emails.service';

const templateCandidates = [
  process.env.EMAIL_TEMPLATE_DIR,
  join(__dirname, 'templates'),
  join(process.cwd(), 'dist', 'emails', 'templates'),
  join(process.cwd(), 'src', 'emails', 'templates'),
].filter((path): path is string => Boolean(path));

const templatesDir =
  templateCandidates.find((dir) => existsSync(dir)) || join(__dirname, 'templates');

const emailPassword = process.env.EMAIL_PASSWORD?.replace(/\s+/g, '');

console.log('[EmailsModule] Email configuration check:');
console.log('[EmailsModule] EMAIL env var:', process.env.EMAIL ? 'SET' : 'NOT SET');
console.log('[EmailsModule] EMAIL_PASSWORD env var:', emailPassword ? 'SET' : 'NOT SET');
console.log('[EmailsModule] EMAIL_FROM env var:', process.env.EMAIL_FROM ? 'SET' : 'NOT SET');

const hasAuth = process.env.EMAIL && emailPassword;
console.log('[EmailsModule] Auth will be configured:', hasAuth ? 'YES' : 'NO - emails will fail!');

@Module({
imports: [
MailerModule.forRoot({
transport: {
host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: hasAuth
          ? {
              user: process.env.EMAIL,
              pass: emailPassword,
            }
          : undefined,
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
      },
      defaults: {
        from: process.env.EMAIL_FROM || process.env.EMAIL,
      },
      template: {
        dir: templatesDir,
        adapter: new HandlebarsAdapter(),
        options: {
          strict: true,
        },
      },
    }),
  ],
  providers: [EmailsService],
  exports: [EmailsService],
})
export class EmailsModule { }
