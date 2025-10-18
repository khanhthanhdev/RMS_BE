import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailsService {
  constructor(private readonly mailerService: MailerService) {}

  async sendAccountActivationInvite(to: string, activationUrl: string) {
  await this.mailerService.sendMail({
  to,
  subject: 'Welcome to our app!',
  template: 'account-activation-invitation',
  context: {
  email: to,
  activationUrl,
  },
  });
  }

  async sendBulkUserCreationEmail(to: string, username: string, password: string, role: string, loginUrl: string) {
    console.log(`[EmailsService] Sending bulk creation email to: ${to} with template: bulk-user-creation`);

    try {
      // Try with direct HTML instead of template to avoid template loading issues
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🎯 Your Account Has Been Created</h1>
          <p style="margin: 10px 0 0 0;">Welcome to the Tournament Management System</p>
        </div>

        <div style="background-color: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px;">
          <div style="background-color: #ffffff; padding: 25px; border-radius: 8px; border: 2px solid #e5e7eb; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0; text-align: center;">Your Login Credentials</h2>

            <div style="background-color: #f0f9ff; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #0ea5e9;">
              <h3 style="margin: 0 0 10px 0; color: #0c4a6e;">📋 Account Details</h3>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Username:</strong> <code style="background-color: #e0f2fe; padding: 2px 6px; border-radius: 3px; font-family: monospace;">${username}</code></p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Password:</strong> <code style="background-color: #fef3c7; padding: 2px 6px; border-radius: 3px; font-family: monospace; color: #92400e;">${password}</code></p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Role:</strong> <span style="background-color: #ecfdf5; color: #065f46; padding: 2px 8px; border-radius: 12px; font-weight: bold;">${role}</span></p>
            </div>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background-color: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);">🔐 Login to Your Account</a>
          </div>

          <div style="background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <h4 style="margin: 0 0 10px 0; color: #92400e;">⚠️ Important Security Notice</h4>
            <ul style="margin: 0; padding-left: 20px; color: #92400e;">
              <li>Keep your credentials secure and do not share them</li>
              <li>Change your password after first login for better security</li>
              <li>Contact your administrator if you have any issues</li>
            </ul>
          </div>

          <p style="text-align: center; margin: 20px 0; color: #6b7280;">
            If you have any questions or need assistance, please contact your system administrator.
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

          <p style="text-align: center; margin: 20px 0; font-size: 14px; color: #9ca3af;">
            <strong>Tournament Management System</strong><br>
            Best regards, Tournament Management Team
          </p>
        </div>
      </div>
    `;

    const result = await this.mailerService.sendMail({
      to,
      subject: `Your Tournament Management Account Credentials - ${role}`,
      html: htmlContent,
    });

    console.log(`[EmailsService] Bulk creation email sent successfully to: ${to}`);
    console.log(`[EmailsService] Mailer result:`, result);
    } catch (error) {
      console.error(`[EmailsService] Failed to send bulk creation email to ${to}:`, error);
      console.error(`[EmailsService] Error details:`, {
        message: error.message,
        code: error.code,
        response: error.response,
        responseCode: error.responseCode,
      });
      throw error;
    }
  }

  async sendUserAccountInfoEmail(
    to: string,
    username: string,
    password: string,
    role: string,
    loginUrl: string
  ) {
    console.log(`[EmailsService] Sending account info email to: ${to} with username: ${username}`);

    try {
      // Send account information email with credentials
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🎯 Your Account Has Been Created</h1>
          <p style="margin: 10px 0 0 0;">Welcome to the Tournament Management System</p>
        </div>

        <div style="background-color: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px;">
          <div style="background-color: #ffffff; padding: 25px; border-radius: 8px; border: 2px solid #e5e7eb; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0; text-align: center;">Your Login Credentials</h2>

            <div style="background-color: #f0f9ff; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #0ea5e9;">
              <h3 style="margin: 0 0 10px 0; color: #0c4a6e;">📋 Account Details</h3>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Username:</strong> <code style="background-color: #e0f2fe; padding: 2px 6px; border-radius: 3px; font-family: monospace;">${username}</code></p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Password:</strong> <code style="background-color: #fef3c7; padding: 2px 6px; border-radius: 3px; font-family: monospace; color: #92400e;">${password}</code></p>
              <p style="margin: 8px 0; font-size: 16px;"><strong>Role:</strong> <span style="background-color: #ecfdf5; color: #065f46; padding: 2px 8px; border-radius: 12px; font-weight: bold;">${role}</span></p>
            </div>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${loginUrl}" style="background-color: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);">🔐 Login to Your Account</a>
          </div>

          <div style="background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
            <h4 style="margin: 0 0 10px 0; color: #92400e;">⚠️ Important Security Notice</h4>
            <ul style="margin: 0; padding-left: 20px; color: #92400e;">
              <li>Keep your credentials secure and do not share them</li>
              <li>Change your password after first login for better security</li>
              <li>Contact your administrator if you have any issues</li>
            </ul>
          </div>

          <p style="text-align: center; margin: 20px 0; color: #6b7280;">
            If you have any questions or need assistance, please contact your system administrator.
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

          <p style="text-align: center; margin: 20px 0; font-size: 14px; color: #9ca3af;">
            <strong>Tournament Management System</strong><br>
            Best regards, Tournament Management Team
          </p>
        </div>
      </div>
    `;

    const result = await this.mailerService.sendMail({
      to,
      subject: `Your Tournament Management Account Credentials - ${role}`,
      html: htmlContent,
    });

    console.log(`[EmailsService] Account info email sent successfully to: ${to}`);
    console.log(`[EmailsService] Mailer result:`, result);
    } catch (error) {
      console.error(`[EmailsService] Failed to send account info email to ${to}:`, error);
      console.error(`[EmailsService] Error details:`, {
        message: error.message,
        code: error.code,
        response: error.response,
        responseCode: error.responseCode,
      });
      throw error;
    }
  }

  async sendTeamAssignmentInvitationEmail(
    to: string,
    teamName: string,
    tournamentName: string,
  ) {
    await this.mailerService.sendMail({
      to,
      subject: 'Team Assignment Invitation',
      template: 'team-assignment-invitation',
      context: {
        email: to,
        teamName,
        tournamentName,
      },
    });
  }
}
